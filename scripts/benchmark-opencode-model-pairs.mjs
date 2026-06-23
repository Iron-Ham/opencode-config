#!/usr/bin/env bun

import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import os from "node:os";
import path from "node:path";
import process from "node:process";

process.umask(0o077);

const combinations = {
  "sonnet-sol": {
    implementer: { model: "anthropic/claude-sonnet-5" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "sonnet-terra": {
    implementer: { model: "anthropic/claude-sonnet-5" },
    advisor: { model: "openai/gpt-5.6-terra", variant: "xhigh" },
  },
  "luna-sol": {
    implementer: { model: "openai/gpt-5.6-luna", variant: "xhigh" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "luna-sonnet": {
    implementer: { model: "openai/gpt-5.6-luna", variant: "xhigh" },
    advisor: { model: "anthropic/claude-sonnet-5", variant: "high" },
  },
  "luna-opus": {
    implementer: { model: "openai/gpt-5.6-luna", variant: "xhigh" },
    advisor: { model: "anthropic/claude-opus-4-8", variant: "high" },
  },
  "luna-fable": {
    implementer: { model: "openai/gpt-5.6-luna", variant: "xhigh" },
    advisor: { model: "anthropic/claude-fable-5", variant: "high" },
  },
  "terra-opus": {
    implementer: { model: "openai/gpt-5.6-terra", variant: "xhigh" },
    advisor: { model: "anthropic/claude-opus-4-8", variant: "high" },
  },
  "terra-sonnet": {
    implementer: { model: "openai/gpt-5.6-terra", variant: "xhigh" },
    advisor: { model: "anthropic/claude-sonnet-5", variant: "high" },
  },
};

const ADVISOR_SYSTEM =
  "You are a senior advisor to a coding agent (the executor). " +
  "You are given the executor's full conversation transcript and, optionally, a specific focus. " +
  "Provide concise strategic guidance: a plan, a course correction, or the key design " +
  "decision and pitfalls to avoid. Do NOT write the full implementation; the executor " +
  "will carry it out. Be direct and specific. Keep it under 300 words.";
const ADVISOR_FOCUS =
  "Audit correctness, causal completeness, repair safety, and test coverage; prioritize only material changes.";
const PROTOCOL = "staged-draft-review-revision-v1";
const MESSAGE_TRUNCATE_MAX = 4000;
const TRANSCRIPT_CHAR_BUDGET = 60000;
const CONTROLLER_STEPS = 100;
const ADVISOR_STEPS = 4;
const REQUEST_TIMEOUT_MS = 10 * 60 * 1000;
const TERMINATION_GRACE_MS = 5000;
const OPENAI_PRICING = {
  "openai/gpt-5.6-luna": {
    input: 1,
    output: 6,
    cache_read: 0.1,
    cache_write: 1.25,
  },
  "openai/gpt-5.6-sol": {
    input: 5,
    output: 30,
    cache_read: 0.5,
    cache_write: 6.25,
  },
  "openai/gpt-5.6-terra": {
    input: 2.5,
    output: 15,
    cache_read: 0.25,
    cache_write: 3.125,
  },
};
const OPENAI_LONG_CONTEXT_THRESHOLD = 272000;

function ensurePrivateDirectory(directory) {
  const existing = fs.lstatSync(directory, { throwIfNoEntry: false });
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
    throw new Error(`Private benchmark path is not a real directory: ${directory}`);
  }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function writePrivateFile(filePath, contents) {
  ensurePrivateDirectory(path.dirname(filePath));
  const existing = fs.lstatSync(filePath, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink()) {
    throw new Error(`Refusing to replace symbolic link: ${filePath}`);
  }
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`,
  );
  let descriptor = fs.openSync(temporaryPath, "wx", 0o600);
  try {
    fs.writeFileSync(descriptor, contents);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    fs.renameSync(temporaryPath, filePath);
    fs.chmodSync(filePath, 0o600);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    fs.rmSync(temporaryPath, { force: true });
  }
}

function preparePrivateDataHome(outputDir) {
  const dataHome = path.join(outputDir, "xdg-data");
  ensurePrivateDirectory(path.join(dataHome, "opencode"));
  enforcePrivateTree(dataHome);
  return dataHome;
}

function enforcePrivateTree(root) {
  const entry = fs.lstatSync(root, { throwIfNoEntry: false });
  if (!entry) return;
  if (entry.isSymbolicLink()) {
    throw new Error(`Private benchmark state must not contain symbolic links: ${root}`);
  }
  if (entry.isDirectory()) {
    fs.chmodSync(root, 0o700);
    for (const child of fs.readdirSync(root)) {
      enforcePrivateTree(path.join(root, child));
    }
    return;
  }
  if (!entry.isFile()) {
    throw new Error(`Unsupported entry in private benchmark state: ${root}`);
  }
  fs.chmodSync(root, 0o600);
}

function absorbAndScrubPersistedAuth(dataHome, authState) {
  const authPath = path.join(dataHome, "opencode", "auth.json");
  const entry = fs.lstatSync(authPath, { throwIfNoEntry: false });
  if (entry) {
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error("Refusing unexpected persisted OpenCode auth entry");
    }
    const refreshed = fs.readFileSync(authPath, "utf8");
    try {
      JSON.parse(refreshed);
      authState.content = refreshed;
    } finally {
      fs.rmSync(authPath, { force: true });
    }
  }
  enforcePrivateTree(dataHome);
  if (fs.existsSync(authPath)) {
    throw new Error("OpenCode auth material remained in the benchmark output");
  }
}

function loadAuthContent() {
  if (process.env.OPENCODE_AUTH_CONTENT) return process.env.OPENCODE_AUTH_CONTENT;
  const sourceDataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return fs.readFileSync(path.join(sourceDataHome, "opencode", "auth.json"), "utf8");
}

function readOptionalConfig(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const source = fs.readFileSync(filePath, "utf8");
  return Bun.JSONC.parse(source);
}

function disabledBenchmarkMcps(cwd) {
  const configPaths = [
    path.join(os.homedir(), ".config", "opencode", "opencode.json"),
    path.join(os.homedir(), ".config", "opencode", "opencode.jsonc"),
    path.join(cwd, "opencode.json"),
    path.join(cwd, "opencode.jsonc"),
    path.join(cwd, ".opencode", "opencode.json"),
    path.join(cwd, ".opencode", "opencode.jsonc"),
  ];
  const names = new Set();
  for (const configPath of configPaths) {
    const config = readOptionalConfig(configPath);
    for (const name of Object.keys(config.mcp ?? {})) names.add(name);
  }
  return Object.fromEntries([...names].sort().map((name) => [name, { enabled: false }]));
}

function createBenchmarkConfig(cwd) {
  return JSON.stringify({
    snapshot: false,
    share: "disabled",
    mcp: disabledBenchmarkMcps(cwd),
    provider: {
      openai: {
        options: {
          headerTimeout: false,
          timeout: 600000,
          chunkTimeout: 120000,
        },
      },
    },
    agent: {
      benchmark_controller: {
        mode: "primary",
        steps: CONTROLLER_STEPS,
        permission: {
          "*": "deny",
          read: {
            "*": "allow",
            ".env": "deny",
            ".env.*": "deny",
            "*.env": "deny",
            "*.env.*": "deny",
          },
          glob: "allow",
          grep: "allow",
        },
      },
      benchmark_advisor: {
        mode: "primary",
        prompt: ADVISOR_SYSTEM,
        steps: ADVISOR_STEPS,
        permission: {
          "*": "deny",
        },
      },
    },
    permission: {
      advisor: "deny",
    },
  });
}

function usage() {
  console.error(
    "Usage: benchmark-opencode-model-pairs.mjs --task-file PATH --round NAME --output-dir PATH --combos NAME[,NAME...] [--rubric-file PATH] [--workdir PATH] [--seed VALUE] [--repeat N] [--concurrency N]",
  );
  console.error(
    "       benchmark-opencode-model-pairs.mjs --summary-file PATH --round NAME --output-dir PATH --rubric-file PATH [--seed VALUE]",
  );
  console.error(`Combinations: ${Object.keys(combinations).join(", ")}`);
}

function parseArguments(argv) {
  const result = { repeat: 3, concurrency: 1, seed: Date.now().toString(36) };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}`);
    }
    const name = argument.slice(2).replaceAll("-", "_");
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}`);
    }
    result[name] = value;
    index += 1;
  }
  result.repeat = Number.parseInt(String(result.repeat), 10);
  result.concurrency = Number.parseInt(String(result.concurrency), 10);
  return result;
}

function validateRoundName(round) {
  if (
    typeof round !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(round) ||
    round === "." ||
    round === ".."
  ) {
    throw new Error(
      "--round must be a safe 1-80 character filename component containing only letters, digits, dots, underscores, or hyphens",
    );
  }
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function parseEvents(output) {
  const events = [];
  const lines = output.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      const incompleteTrailingLine =
        index === lines.length - 1 && !output.endsWith("\n");
      if (incompleteTrailingLine) continue;
      throw new Error(`Malformed OpenCode JSON event at line ${index + 1}`, {
        cause: error,
      });
    }
  }
  return events;
}

function extractText(events) {
  const terminalMessageID = events.findLast(
    (event) => event.type === "step_finish" && event.part?.reason === "stop",
  )?.part?.messageID ?? events.findLast(
    (event) => event.type === "text",
  )?.part?.messageID;
  return events
    .filter(
      (event) => event.type === "text" &&
        event.part?.messageID === terminalMessageID,
    )
    .map((event) => event.part?.text ?? "")
    .join("")
    .trim();
}

function assertToolPathsStayInWorkdir(events, cwd) {
  const root = path.resolve(cwd);
  const rootPrefix = `${root}${path.sep}`;
  const pathKeys = new Set(["directory", "filePath", "path", "workdir"]);
  for (const event of events) {
    if (event.type !== "tool_use") continue;
    const input = event.part?.state?.input;
    if (!input || typeof input !== "object") continue;
    for (const [key, value] of Object.entries(input)) {
      const isGlobPattern = event.part?.tool === "glob" && key === "pattern";
      if (
        (!pathKeys.has(key) && !isGlobPattern) ||
        typeof value !== "string" ||
        !path.isAbsolute(value)
      ) {
        continue;
      }
      const resolved = path.resolve(value);
      if (resolved !== root && !`${resolved}${path.sep}`.startsWith(rootPrefix)) {
        throw new Error(`Benchmark tool attempted to access outside --workdir: ${value}`);
      }
    }
  }
}

function truncate(value, max = 1500) {
  return value.length <= max
    ? value
    : `${value.slice(0, max)}… [truncated ${value.length - max} chars]`;
}

function renderTranscriptPart(part) {
  switch (part.type) {
    case "text":
      return part.text ? truncate(part.text, MESSAGE_TRUNCATE_MAX) : null;
    case "reasoning":
      return part.text
        ? `[reasoning] ${truncate(part.text, MESSAGE_TRUNCATE_MAX)}`
        : null;
    case "subtask":
      return `[subtask -> ${part.agent || "unknown"}] ${truncate(
        part.description || part.prompt || "",
        MESSAGE_TRUNCATE_MAX,
      )}`;
    case "tool": {
      const name = part.tool || "unknown";
      const state = part.state;
      if (!state) return `[tool: ${name}]`;
      const input = state.input ? truncate(JSON.stringify(state.input)) : "";
      if (state.status === "completed") {
        return `[tool: ${name}] ${input} -> ${truncate(state.output || "(empty)")}`;
      }
      if (state.status === "error") {
        return `[tool: ${name}] ${input} -> ERROR: ${state.error || "(unknown)"}`;
      }
      return `[tool: ${name}] ${input} -> (${state.status})`;
    }
    case "file":
      return `[attachment: ${part.filename || part.url || "unknown"}]`;
    default:
      return null;
  }
}

function capTranscript(blocks) {
  let total = blocks.reduce((sum, block) => sum + block.length, 0);
  let dropped = 0;
  while (total > TRANSCRIPT_CHAR_BUDGET && dropped < blocks.length - 1) {
    total -= blocks[dropped].length;
    dropped += 1;
  }
  const note = dropped > 0
    ? [`(${dropped} earlier message${dropped === 1 ? "" : "s"} omitted for length)`]
    : [];
  return [...note, ...blocks.slice(dropped)].join("\n\n");
}

function serializeTranscript(messages) {
  return capTranscript(messages.map((message) => {
    const role = (message.info?.role || "unknown").toUpperCase();
    const body = (message.parts || [])
      .map(renderTranscriptPart)
      .filter((part) => part !== null)
      .join("\n");
    return `### ${role}\n${body || "(no content)"}`;
  }));
}

function openCodeDatabasePath(dataHome) {
  return path.join(dataHome, "opencode", "opencode.db");
}

function loadSessionMessages(sessionID, dataHome) {
  const database = new Database(openCodeDatabasePath(dataHome), { readonly: true });
  try {
    const messages = database.query(
      "SELECT id, data FROM message WHERE session_id = ? ORDER BY time_created, id",
    ).all(sessionID).map((row) => ({
      id: row.id,
      info: JSON.parse(row.data),
      parts: [],
    }));
    const partsQuery = database.query(
      "SELECT id, data FROM part WHERE message_id = ? ORDER BY id ASC",
    );
    for (const message of messages) {
      message.parts = partsQuery.all(message.id)
        .sort((left, right) => left.id.localeCompare(right.id))
        .map((row) => JSON.parse(row.data));
    }
    return messages;
  } finally {
    database.close();
  }
}

function sessionExists(sessionID, dataHome) {
  const databasePath = openCodeDatabasePath(dataHome);
  if (!fs.existsSync(databasePath)) return false;
  let database;
  try {
    database = new Database(databasePath, { readonly: true });
    return Boolean(database.query(
      "SELECT 1 AS present FROM message WHERE session_id = ? LIMIT 1",
    ).get(sessionID));
  } catch {
    return false;
  } finally {
    database?.close();
  }
}

let cachedOpenCodeVersion;

function openCodeVersion() {
  if (cachedOpenCodeVersion !== undefined) return cachedOpenCodeVersion;
  const result = Bun.spawnSync(["opencode", "--version"], {
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`Cannot determine OpenCode version: ${result.stderr.toString()}`);
  }
  cachedOpenCodeVersion = result.stdout.toString().trim();
  return cachedOpenCodeVersion;
}

function commandText(command, cwd, env = process.env) {
  const result = Bun.spawnSync(command, {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`Command failed (${command.join(" ")}): ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

const repositoryMetadataCache = new Map();

function repositoryMetadata(cwd) {
  if (repositoryMetadataCache.has(cwd)) return repositoryMetadataCache.get(cwd);
  const commit = commandText(["git", "rev-parse", "HEAD"], cwd).trim();
  const status = commandText(["git", "status", "--porcelain=v1"], cwd);
  const diff = commandText(["git", "diff", "--binary", "HEAD"], cwd);
  const instructionFiles = commandText(["git", "ls-files", "*AGENTS.md"], cwd)
    .trim()
    .split("\n")
    .filter(Boolean);
  const instructionHashes = Object.fromEntries(instructionFiles.map((relativePath) => [
    relativePath,
    createHash("sha256").update(
      fs.readFileSync(path.join(cwd, relativePath)),
    ).digest("hex"),
  ]));
  const globalInstructions = path.join(os.homedir(), ".config", "opencode", "AGENTS.md");
  if (fs.existsSync(globalInstructions)) {
    instructionHashes[globalInstructions] = createHash("sha256")
      .update(fs.readFileSync(globalInstructions))
      .digest("hex");
  }
  const metadata = {
    commit,
    dirty: status.length > 0,
    dirty_sha256: createHash("sha256").update(status).update(diff).digest("hex"),
    instruction_sha256: instructionHashes,
  };
  repositoryMetadataCache.set(cwd, metadata);
  return metadata;
}

const modelCatalogHashCache = new Map();

function modelCatalogHash(cwd, model) {
  const provider = model.split("/", 1)[0];
  const key = `${cwd}:${provider}`;
  if (modelCatalogHashCache.has(key)) return modelCatalogHashCache.get(key);
  const catalog = commandText(
    ["opencode", "models", provider, "--verbose"],
    cwd,
    { ...process.env, OPENCODE_CONFIG_CONTENT: createBenchmarkConfig(cwd) },
  );
  const hash = createHash("sha256").update(catalog).digest("hex");
  modelCatalogHashCache.set(key, hash);
  return hash;
}

function deterministicOrder(values, seed, identity = (value) => String(value)) {
  return [...values].sort((left, right) => {
    const leftIdentity = identity(left);
    const rightIdentity = identity(right);
    const leftHash = createHash("sha256")
      .update(`${seed}:${leftIdentity}`)
      .digest("hex");
    const rightHash = createHash("sha256")
      .update(`${seed}:${rightIdentity}`)
      .digest("hex");
    return leftHash.localeCompare(rightHash) ||
      leftIdentity.localeCompare(rightIdentity);
  });
}

function draftFingerprint({ cwd, task, implementer }) {
  const runnerSource = fs.readFileSync(new URL(import.meta.url), "utf8");
  return createHash("sha256").update(JSON.stringify({
    schema: 4,
    protocol: PROTOCOL,
    cwd,
    task,
    implementer,
    benchmark_config: createBenchmarkConfig(cwd),
    opencode_version: openCodeVersion(),
    repository: repositoryMetadata(cwd),
    model_catalog_sha256: modelCatalogHash(cwd, implementer.model),
    runner_sha256: createHash("sha256").update(runnerSource).digest("hex"),
  })).digest("hex");
}

function trialFingerprint({
  cwd,
  task,
  combinationName,
  repetition,
  draft,
  transcriptSha256,
}) {
  const combination = combinations[combinationName];
  const runnerSource = fs.readFileSync(new URL(import.meta.url), "utf8");
  return createHash("sha256").update(JSON.stringify({
    schema: 1,
    protocol: PROTOCOL,
    cwd,
    task,
    combination_name: combinationName,
    combination,
    repetition,
    draft_fingerprint: draft.fingerprint,
    draft_session_id: draft.session_id,
    transcript_sha256: transcriptSha256,
    advisor_system: ADVISOR_SYSTEM,
    advisor_focus: ADVISOR_FOCUS,
    benchmark_config: createBenchmarkConfig(cwd),
    opencode_version: openCodeVersion(),
    repository: repositoryMetadata(cwd),
    model_catalog_sha256: {
      implementer: modelCatalogHash(cwd, combination.implementer.model),
      advisor: modelCatalogHash(cwd, combination.advisor.model),
    },
    runner_sha256: createHash("sha256").update(runnerSource).digest("hex"),
  })).digest("hex");
}

function recomputedRequestCost(event, model) {
  const pricing = OPENAI_PRICING[model];
  if (!pricing) return Number(event.part?.cost ?? 0);
  const tokens = event.part?.tokens ?? {};
  const cacheRead = Number(tokens.cache?.read ?? 0);
  const cacheWrite = Number(tokens.cache?.write ?? 0);
  const input = Number(tokens.input ?? 0);
  const output = Number(tokens.output ?? 0) + Number(tokens.reasoning ?? 0);
  const contextInput = input + cacheRead + cacheWrite;
  const longContext = contextInput > OPENAI_LONG_CONTEXT_THRESHOLD;
  const inputMultiplier = longContext ? 2 : 1;
  const outputMultiplier = longContext ? 1.5 : 1;
  return (
    input * pricing.input * inputMultiplier +
    cacheRead * pricing.cache_read * inputMultiplier +
    cacheWrite * pricing.cache_write * inputMultiplier +
    output * pricing.output * outputMultiplier
  ) / 1_000_000;
}

function summarize(events, wallTimeMs, model) {
  const finishes = events.filter((event) => event.type === "step_finish");
  const tools = events
    .filter((event) => event.type === "tool_use")
    .map((event) => event.part?.tool)
    .filter(Boolean);
  const toolCounts = Object.fromEntries(
    [...new Set(tools)].sort().map((tool) => [
      tool,
      tools.filter((candidate) => candidate === tool).length,
    ]),
  );
  const sum = (selector) => finishes.reduce(
    (total, event) => total + Number(selector(event) ?? 0),
    0,
  );
  return {
    wall_time_seconds: wallTimeMs / 1000,
    requests: finishes.length,
    tool_calls: tools.length,
    tool_counts: toolCounts,
    cost_scope: "completed_requests_lower_bound",
    reported_cost_usd: sum((event) => event.part?.cost),
    recomputed_cost_usd: finishes.reduce(
      (total, event) => total + recomputedRequestCost(event, model),
      0,
    ),
    tokens: {
      traffic: sum((event) => event.part?.tokens?.total),
      input: sum((event) => event.part?.tokens?.input),
      output: sum((event) => event.part?.tokens?.output),
      reasoning: sum((event) => event.part?.tokens?.reasoning),
      cache_read: sum((event) => event.part?.tokens?.cache?.read),
      cache_write: sum((event) => event.part?.tokens?.cache?.write),
    },
  };
}

async function runOpenCode({ cwd, model, variant, agent, title, prompt, dataHome, authState, session, fork = false }) {
  const args = [
    "run",
    "--pure",
    "--agent",
    agent,
    "--dir",
    cwd,
    "--model",
    model,
    "--format",
    "json",
    "--title",
    title,
  ];
  if (variant) args.push("--variant", variant);
  if (session) args.push("--session", session);
  if (fork) args.push("--fork");
  args.push(prompt);

  const startedAt = performance.now();
  const child = Bun.spawn(["opencode", ...args], {
    cwd,
    env: {
      ...process.env,
      PWD: cwd,
      INIT_CWD: cwd,
      XDG_DATA_HOME: dataHome,
      OPENCODE_AUTH_CONTENT: authState.content,
      OPENCODE_CONFIG_CONTENT: createBenchmarkConfig(cwd),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let forceKillTimeout;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKillTimeout = setTimeout(() => child.kill("SIGKILL"), TERMINATION_GRACE_MS);
  }, REQUEST_TIMEOUT_MS);
  let output;
  let errorOutput;
  let exitCode;
  try {
    [output, errorOutput, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
  } finally {
    clearTimeout(timeout);
    clearTimeout(forceKillTimeout);
    absorbAndScrubPersistedAuth(dataHome, authState);
  }
  const wallTimeMs = performance.now() - startedAt;
  const events = parseEvents(output);
  assertToolPathsStayInWorkdir(events, cwd);
  const sessionID = events.find((event) => event.sessionID)?.sessionID;
  const completed = events.some(
    (event) => event.type === "step_finish" && event.part?.reason === "stop",
  );
  return {
    status: timedOut
      ? "timeout"
      : exitCode !== 0
        ? "failed"
        : completed
          ? "completed"
          : "incomplete",
    exit_code: exitCode,
    session_id: sessionID,
    text: extractText(events),
    metrics: summarize(events, wallTimeMs, model),
    events,
    error: exitCode === 0 ? undefined : (errorOutput || output.slice(-2000)),
  };
}

function withoutEvents(stage) {
  const { events, ...summary } = stage;
  return summary;
}

function stageTotal(stages, selector) {
  return stages.reduce((total, stage) => total + selector(stage), 0);
}

function trialTotals(stages) {
  return {
    cost_scope: "counterfactual_route_cost_including_shared_draft",
    wall_time_seconds: stageTotal(stages, (stage) => stage.metrics.wall_time_seconds),
    tool_calls: stageTotal(stages, (stage) => stage.metrics.tool_calls),
    reported_cost_usd: stageTotal(stages, (stage) => stage.metrics.reported_cost_usd),
    recomputed_cost_usd: stageTotal(stages, (stage) => stage.metrics.recomputed_cost_usd),
    tokens: Object.fromEntries(
      Object.keys(stages[0].metrics.tokens).map((key) => [
        key,
        stageTotal(stages, (stage) => stage.metrics.tokens[key]),
      ]),
    ),
  };
}

function writeStage(directory, name, stage) {
  writePrivateFile(
    path.join(directory, `${name}.jsonl`),
    `${stage.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  writePrivateFile(path.join(directory, `${name}.md`), `${stage.text}\n`);
}

function writeGradingPacket({ outputDir, round, results, rubricFile, seed }) {
  if (!rubricFile) return;

  const rubric = fs.readFileSync(path.resolve(rubricFile), "utf8").trim();
  const candidates = [];
  const seenDrafts = new Set();
  for (const result of results) {
    const draft = result.stages.draft;
    const draftIdentity = draft.session_id ??
      `${draft.fingerprint ?? JSON.stringify(result.implementer)}:${result.round ?? "unknown"}:r${result.repetition}`;
    if (
      draft.status === "completed" &&
      draft.text &&
      !seenDrafts.has(draftIdentity)
    ) {
      seenDrafts.add(draftIdentity);
      candidates.push({
        kind: "unreviewed_draft",
        source: "draft",
        repetition: result.repetition,
        source_trial: result.trial,
        session_id: draft.session_id,
        fingerprint: draft.fingerprint,
        combination: `${result.implementer.model}:${result.implementer.variant ?? "default"}`,
        text: draft.text,
        metrics: draft.metrics,
      });
    }
    const final = result.stages.final;
    if (result.status === "completed" && final?.text) {
      candidates.push({
        kind: "advisor_revised_final",
        source: "final",
        repetition: result.repetition,
        source_trial: result.trial,
        session_id: final.session_id,
        fingerprint: result.fingerprint,
        combination: result.combination,
        text: final.text,
        metrics: result.totals,
      });
    }
  }

  const gradingDir = path.join(outputDir, `${round}-grading`);
  const answersDir = path.join(gradingDir, "answers");
  fs.rmSync(gradingDir, { recursive: true, force: true });
  ensurePrivateDirectory(answersDir);
  const key = deterministicOrder(
    candidates,
    seed,
    (candidate) => `${candidate.kind}:${candidate.combination}:${createHash("sha256")
      .update(candidate.text)
      .digest("hex")}`,
  ).map((candidate, index) => {
    const label = `answer-${String(index + 1).padStart(2, "0")}`;
    writePrivateFile(path.join(answersDir, `${label}.md`), `${candidate.text}\n`);
    const { text, ...metadata } = candidate;
    return { label, ...metadata };
  });
  writePrivateFile(path.join(gradingDir, "rubric.md"), `${rubric}\n`);
  writePrivateFile(
    path.join(gradingDir, "grading-prompt.md"),
    `Blind-grade every Markdown file in answers/. Treat labels as opaque. Use rubric.md as the fixed ground truth. Score factual correctness, causal completeness, source evidence, repair safety, test design, and calibrated uncertainty. Report material errors, a weighted 0-10 score, and a rank order. Do not inspect key.json until grading is final.\n`,
  );
  writePrivateFile(
    path.join(gradingDir, "key.json"),
    `${JSON.stringify(key, null, 2)}\n`,
  );
}

function implementerKey(implementer) {
  return `${implementer.model.replaceAll("/", "-")}-${implementer.variant ?? "default"}`;
}

function recordedExperimentCosts(results) {
  const seenDrafts = new Set();
  const stages = [];
  for (const result of results) {
    const draft = result.stages.draft;
    const draftIdentity = draft.session_id ??
      `${draft.fingerprint ?? JSON.stringify(result.implementer)}:${result.round ?? "unknown"}:r${result.repetition}`;
    if (!seenDrafts.has(draftIdentity)) {
      seenDrafts.add(draftIdentity);
      stages.push(draft);
    }
    if (result.stages.advice) stages.push(result.stages.advice);
    if (result.stages.final) stages.push(result.stages.final);
  }
  return {
    cost_scope: "unique_recorded_stage_cost_counting_each_shared_draft_once",
    reported_cost_usd: stageTotal(
      stages,
      (stage) => stage.metrics.reported_cost_usd,
    ),
    recomputed_cost_usd: stageTotal(
      stages,
      (stage) => stage.metrics.recomputed_cost_usd,
    ),
  };
}

async function runDraft({ cwd, task, round, outputDir, implementer, repetition, dataHome, authState }) {
  const key = implementerKey(implementer);
  const fingerprint = draftFingerprint({ cwd, task, implementer });
  const draftDir = path.join(outputDir, `${round}-${key}-r${repetition}-draft`);
  ensurePrivateDirectory(draftDir);
  const resultPath = path.join(draftDir, "result.json");
  const eventsPath = path.join(draftDir, "draft.jsonl");
  if (fs.existsSync(resultPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(resultPath, "utf8"));
      if (
        saved.status === "completed" &&
        saved.session_id &&
        saved.fingerprint === fingerprint &&
        sessionExists(saved.session_id, dataHome)
      ) {
        let events = [];
        let rawArtifactComplete = false;
        if (fs.existsSync(eventsPath)) {
          try {
            events = parseEvents(fs.readFileSync(eventsPath, "utf8"));
            rawArtifactComplete = true;
          } catch {
            // The atomic result is sufficient to avoid repeating a paid draft.
          }
        }
        console.log(
          `REUSE  ${round}-${key}-r${repetition}${rawArtifactComplete ? "" : " (raw event log unavailable)"}`,
        );
        return { ...saved, events };
      }
      if (saved.status === "completed" && saved.fingerprint === fingerprint) {
        console.log(`STALE  ${round}-${key}-r${repetition} (session unavailable)`);
      }
    } catch {
      console.log(`STALE  ${round}-${key}-r${repetition} (invalid saved result)`);
    }
  }
  console.log(`DRAFT  ${round}-${key}-r${repetition}`);
  const prompt = `Controlled iOS controller benchmark. Read every applicable AGENTS.md first. Do not edit or write files, install anything, run builds or tests, create or update a Goal, call an advisor, or delegate to a subagent. Work independently.\n\n${task}\n\nReturn a source-grounded draft under 1,200 words in the requested structure. Cite path:line evidence and distinguish verified facts from inference.`;
  const draft = await runOpenCode({
    cwd,
    ...implementer,
    agent: "benchmark_controller",
    title: `${round}-${key}-r${repetition}-draft`,
    prompt,
    dataHome,
    authState,
  });
  draft.fingerprint = fingerprint;
  writeStage(draftDir, "draft", draft);
  writePrivateFile(
    path.join(draftDir, "result.json"),
    `${JSON.stringify(withoutEvents(draft), null, 2)}\n`,
  );
  console.log(
    `DRAFT  ${draft.status.padEnd(10)} ${round}-${key}-r${repetition} ${draft.metrics.wall_time_seconds.toFixed(1)}s $${draft.metrics.recomputed_cost_usd.toFixed(4)} ${draft.metrics.tool_calls} tools`,
  );
  return draft;
}

async function runTrial({ cwd, task, round, outputDir, combinationName, repetition, draft, dataHome, authState }) {
  const combination = combinations[combinationName];
  const trialName = `${round}-${combinationName}-r${repetition}`;
  const trialDir = path.join(outputDir, trialName);
  const resultPath = path.join(trialDir, "result.json");
  ensurePrivateDirectory(trialDir);

  if (draft.status !== "completed" || !draft.session_id) {
    console.log(`START  ${trialName}`);
    writeStage(trialDir, "draft", draft);
    const result = {
      status: "draft_failed",
      trial: trialName,
      round,
      repetition,
      combination: combinationName,
      implementer: combination.implementer,
      advisor: combination.advisor,
      stages: { draft: withoutEvents(draft) },
      totals: trialTotals([draft]),
    };
    writePrivateFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`FAIL   ${trialName} (${draft.status} draft)`);
    return result;
  }

  const messages = loadSessionMessages(draft.session_id, dataHome);
  if (messages.length === 0) {
    throw new Error(`Draft session has no messages: ${draft.session_id}`);
  }
  const transcript = serializeTranscript(messages);
  const transcriptSha256 = createHash("sha256").update(transcript).digest("hex");
  const fingerprint = trialFingerprint({
    cwd,
    task,
    combinationName,
    repetition,
    draft,
    transcriptSha256,
  });
  if (fs.existsSync(resultPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(resultPath, "utf8"));
      if (
        saved.status === "completed" &&
        saved.trial === trialName &&
        saved.fingerprint === fingerprint
      ) {
        const rawArtifactsComplete = [
          "advice.jsonl",
          "advice.md",
          "final.jsonl",
          "final.md",
        ].every((name) => fs.existsSync(path.join(trialDir, name)));
        console.log(
          `REUSE  ${trialName}${rawArtifactsComplete ? "" : " (raw artifacts incomplete)"}`,
        );
        return saved;
      }
    } catch {
      console.log(`STALE  ${trialName} (invalid saved result)`);
    }
  }

  console.log(`START  ${trialName}`);
  writeStage(trialDir, "draft", draft);
  const advisorPrompt =
    `## Conversation transcript so far\n${transcript}\n\n` +
    `---\nExecutor's current focus: ${ADVISOR_FOCUS}\n\n` +
    "Provide strategic guidance for the executor:";
  const advice = await runOpenCode({
    cwd,
    ...combination.advisor,
    agent: "benchmark_advisor",
    title: `${trialName}-advice`,
    prompt: advisorPrompt,
    dataHome,
    authState,
  });
  advice.transcript_chars = transcript.length;
  advice.transcript_sha256 = transcriptSha256;
  advice.word_count = advice.text.trim().split(/\s+/).filter(Boolean).length;
  writeStage(trialDir, "advice", advice);

  if (advice.status !== "completed") {
    const result = {
      status: "advisor_failed",
      trial: trialName,
      round,
      repetition,
      fingerprint,
      combination: combinationName,
      implementer: combination.implementer,
      advisor: combination.advisor,
      stages: {
        draft: withoutEvents(draft),
        advice: withoutEvents(advice),
      },
      totals: trialTotals([draft, advice]),
    };
    writePrivateFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`FAIL   ${trialName} (${advice.status} advisor)`);
    return result;
  }

  const finalPrompt = `The single permitted advisor tool returned the result below. Reconcile it against the evidence; do not accept it blindly. Do not edit files, run builds/tests, create a Goal, call an advisor, or delegate. Return the final answer under 1,200 words in the original task's requested structure, with precise path:line citations and explicit uncertainty.\n\n[tool: advisor] -> ${advice.text}`;
  const final = await runOpenCode({
    cwd,
    ...combination.implementer,
    agent: "benchmark_controller",
    title: `${trialName}-final`,
    prompt: finalPrompt,
    dataHome,
    authState,
    session: draft.session_id,
    fork: true,
  });
  writeStage(trialDir, "final", final);

  const result = {
    status: final.status === "completed" ? "completed" : "final_failed",
    trial: trialName,
    round,
    repetition,
    fingerprint,
    combination: combinationName,
    implementer: combination.implementer,
    advisor: combination.advisor,
    stages: {
      draft: withoutEvents(draft),
      advice: withoutEvents(advice),
      final: withoutEvents(final),
    },
    totals: trialTotals([draft, advice, final]),
  };
  writePrivateFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
  console.log(
    `${result.status === "completed" ? "DONE" : "FAIL"}   ${trialName} ${result.totals.wall_time_seconds.toFixed(1)}s $${result.totals.recomputed_cost_usd.toFixed(4)} ${result.totals.tool_calls} tools`,
  );
  return result;
}

async function main() {
  let args;
  try {
    args = parseArguments(process.argv.slice(2));
  } catch (error) {
    usage();
    throw error;
  }
  if (args.round) validateRoundName(args.round);
  if (args.summary_file) {
    for (const required of ["round", "output_dir", "rubric_file"]) {
      if (!args[required]) {
        usage();
        throw new Error(`Missing --${required.replaceAll("_", "-")}`);
      }
    }
    const results = JSON.parse(
      fs.readFileSync(path.resolve(args.summary_file), "utf8"),
    );
    writeGradingPacket({
      outputDir: path.resolve(args.output_dir),
      round: args.round,
      results,
      rubricFile: args.rubric_file,
      seed: `${args.seed}:grading:${args.round}`,
    });
    return;
  }
  for (const required of ["task_file", "round", "output_dir", "combos"]) {
    if (!args[required]) {
      usage();
      throw new Error(`Missing --${required.replaceAll("_", "-")}`);
    }
  }
  if (!Number.isInteger(args.repeat) || args.repeat < 1) {
    throw new Error("--repeat must be a positive integer");
  }
  if (args.concurrency !== 1) {
    throw new Error("--concurrency must be 1 so OAuth refresh state and latency remain isolated");
  }

  const cwd = path.resolve(args.workdir ?? process.cwd());
  if (!fs.statSync(cwd, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Workdir is not a directory: ${cwd}`);
  }
  const repository = repositoryMetadata(cwd);
  if (repository.dirty) {
    throw new Error(
      `Benchmark workdir must be clean so source fingerprints are reproducible: ${cwd}`,
    );
  }
  const task = fs.readFileSync(path.resolve(args.task_file), "utf8").trim();
  const outputDir = path.resolve(args.output_dir);
  const selected = args.combos.split(",").map((name) => name.trim()).filter(Boolean);
  if (selected.length === 0) {
    throw new Error("--combos must select at least one route");
  }
  if (new Set(selected).size !== selected.length) {
    throw new Error("--combos must not contain duplicate routes");
  }
  for (const name of selected) {
    if (!combinations[name]) throw new Error(`Unknown combination: ${name}`);
  }
  ensurePrivateDirectory(outputDir);
  if (isPathInside(fs.realpathSync(cwd), fs.realpathSync(outputDir))) {
    throw new Error(
      "--output-dir must be outside --workdir so the read-only benchmark controller cannot access private OpenCode state",
    );
  }
  const dataHome = preparePrivateDataHome(outputDir);
  const authState = { content: loadAuthContent() };
  absorbAndScrubPersistedAuth(dataHome, authState);
  writePrivateFile(path.join(outputDir, `${args.round}-task.md`), `${task}\n`);

  const executionOrder = Object.fromEntries(
    Array.from({ length: args.repeat }, (_, index) => {
      const repetition = index + 1;
      return [
        `repetition_${repetition}`,
        deterministicOrder(selected, `${args.seed}:routes:${repetition}`),
      ];
    }),
  );
  const allModels = [...new Set(selected.flatMap((name) => [
    combinations[name].implementer.model,
    combinations[name].advisor.model,
  ]))];
  const metadata = {
    round: args.round,
    seed: String(args.seed),
    workdir: cwd,
    opencode_version: openCodeVersion(),
    protocol: PROTOCOL,
    repeat: args.repeat,
    concurrency: args.concurrency,
    controller_steps: CONTROLLER_STEPS,
    advisor_steps: ADVISOR_STEPS,
    request_timeout_seconds: REQUEST_TIMEOUT_MS / 1000,
    termination_grace_seconds: TERMINATION_GRACE_MS / 1000,
    advisor_system_sha256: createHash("sha256").update(ADVISOR_SYSTEM).digest("hex"),
    cost_semantics: {
      request_cost:
        "Each stage sums completed OpenCode request events. A timed-out or otherwise incomplete request is a lower bound because no terminal usage event may exist.",
      openai_long_context:
        "For OpenAI requests above 272k input plus cache-read plus cache-write tokens, recomputed cost applies 2x to input/cache and 1.5x to output including reasoning.",
      route_total:
        "Each route total includes its implementer draft, even when that draft is shared with other advisor routes. Treat this as the counterfactual cost of choosing the route; do not sum route totals to estimate experiment spend.",
      experiment_spend:
        "The final metadata records each shared draft once plus each route's advice and revision stages. Reused completed artifacts remain part of the recorded experiment but do not incur new spend in the current invocation.",
    },
    state_storage: {
      database: "Private XDG data directory under output-dir (directories 0700; files 0600).",
      authentication:
        "Passed to OpenCode in process environment; any refreshed auth.json is absorbed into memory and removed after each OpenCode stage.",
    },
    repository,
    task_sha256: createHash("sha256").update(task).digest("hex"),
    rubric_sha256: args.rubric_file
      ? createHash("sha256").update(
        fs.readFileSync(path.resolve(args.rubric_file)),
      ).digest("hex")
      : undefined,
    benchmark_config_sha256: createHash("sha256")
      .update(createBenchmarkConfig(cwd))
      .digest("hex"),
    model_catalog_sha256: Object.fromEntries(
      allModels.map((model) => [model, modelCatalogHash(cwd, model)]),
    ),
    selected_routes: selected,
    execution_order: executionOrder,
    grading_seed: `${args.seed}:grading:${args.round}`,
  };
  writePrivateFile(
    path.join(outputDir, `${args.round}-metadata.json`),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );

  const results = [];
  for (let repetition = 1; repetition <= args.repeat; repetition += 1) {
    const orderedCombinations = executionOrder[`repetition_${repetition}`];
    const drafts = new Map();
    for (const combinationName of orderedCombinations) {
      const implementer = combinations[combinationName].implementer;
      const key = implementerKey(implementer);
      if (!drafts.has(key)) {
        drafts.set(key, await runDraft({
          cwd,
          task,
          round: args.round,
          outputDir,
          implementer,
          repetition,
          dataHome,
          authState,
        }));
      }
    }
    for (let index = 0; index < orderedCombinations.length; index += args.concurrency) {
      const batch = orderedCombinations.slice(index, index + args.concurrency);
      results.push(...await Promise.all(batch.map((combinationName) => {
        const implementer = combinations[combinationName].implementer;
        return runTrial({
          cwd,
          task,
          round: args.round,
          outputDir,
          combinationName,
          repetition,
          draft: drafts.get(implementerKey(implementer)),
          dataHome,
          authState,
        });
      })));
    }
  }
  writePrivateFile(
    path.join(outputDir, `${args.round}-summary.json`),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  metadata.recorded_experiment_cost = recordedExperimentCosts(results);
  writePrivateFile(
    path.join(outputDir, `${args.round}-metadata.json`),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  writeGradingPacket({
    outputDir,
    round: args.round,
    results,
    rubricFile: args.rubric_file,
    seed: metadata.grading_seed,
  });
  absorbAndScrubPersistedAuth(dataHome, authState);
}

await main();
