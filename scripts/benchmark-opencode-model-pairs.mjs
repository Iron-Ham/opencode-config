#!/usr/bin/env bun

import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { Database } from "bun:sqlite";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  assertRawBenchmarkOutputOutsideRepository,
} from "./benchmark-output-containment.mjs";
import {
  assertParallelModelAuthSafe,
  benchmarkConfigWithProviders,
  benchmarkInstructionManifest,
  isolatedOpenCodeEnvironment,
  loadOpenCodeAuthContent,
  recomputedRequestCost,
  resolveBenchmarkModelRoute,
  summarizeEventTiming,
} from "./opencode-benchmark-runtime.mjs";

process.umask(0o077);

const RUNNER_SHA256 = createHash("sha256")
  .update(fs.readFileSync(new URL(import.meta.url), "utf8"))
  .digest("hex");

const combinations = {
  "plan-terra": {
    implementer: { model: "openai/gpt-5.6-terra", variant: "xhigh" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "plan-terra-high": {
    implementer: { model: "openai/gpt-5.6-terra", variant: "high" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "plan-sonnet-default": {
    implementer: { model: "anthropic/claude-sonnet-5" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "plan-sonnet-xhigh": {
    implementer: { model: "anthropic/claude-sonnet-5", variant: "xhigh" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "plan-sol": {
    implementer: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "plan-sol-high": {
    implementer: { model: "openai/gpt-5.6-sol", variant: "high" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "plan-opus": {
    implementer: { model: "anthropic/claude-opus-4-8", variant: "xhigh" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "plan-fable": {
    implementer: { model: "anthropic/claude-fable-5", variant: "xhigh" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "gpt55-xhigh": {
    implementer: { model: "openai/gpt-5.5", variant: "xhigh" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "sol-high": {
    implementer: { model: "openai/gpt-5.6-sol", variant: "high" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "luna-high-sol": {
    implementer: { model: "openai/gpt-5.6-luna", variant: "high" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
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
  "terra-sol": {
    implementer: { model: "openai/gpt-5.6-terra", variant: "xhigh" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "terra-self": {
    implementer: { model: "openai/gpt-5.6-terra", variant: "xhigh" },
    review_mode: "self_review",
  },
  "terra-max-sol": {
    implementer: { model: "openai/gpt-5.6-terra", variant: "max" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "luna-sonnet": {
    implementer: { model: "openai/gpt-5.6-luna", variant: "xhigh" },
    advisor: { model: "anthropic/claude-sonnet-5", variant: "xhigh" },
  },
  "luna-opus": {
    implementer: { model: "openai/gpt-5.6-luna", variant: "xhigh" },
    advisor: { model: "anthropic/claude-opus-4-8", variant: "xhigh" },
  },
  "luna-fable": {
    implementer: { model: "openai/gpt-5.6-luna", variant: "xhigh" },
    advisor: { model: "anthropic/claude-fable-5", variant: "xhigh" },
  },
  "terra-opus": {
    implementer: { model: "openai/gpt-5.6-terra", variant: "xhigh" },
    advisor: { model: "anthropic/claude-opus-4-8", variant: "xhigh" },
  },
  "terra-sonnet": {
    implementer: { model: "openai/gpt-5.6-terra", variant: "xhigh" },
    advisor: { model: "anthropic/claude-sonnet-5", variant: "xhigh" },
  },
  "terra-fable": {
    implementer: { model: "openai/gpt-5.6-terra", variant: "xhigh" },
    advisor: { model: "anthropic/claude-fable-5", variant: "xhigh" },
  },
  "glm-baseten": {
    implementer: { model: "baseten/zai-org/GLM-5.2", variant: "max" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "glm-fireworks": {
    implementer: {
      model: "fireworks-ai/accounts/fireworks/models/glm-5p2",
      variant: "max",
    },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "glm-fireworks-fast": {
    implementer: {
      model: "fireworks-ai/accounts/fireworks/routers/glm-5p2-fast",
      variant: "max",
    },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "kimi-baseten": {
    implementer: { model: "baseten/moonshotai/Kimi-K2.7-Code" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "deepseek-baseten": {
    implementer: { model: "baseten/deepseek-ai/DeepSeek-V4-Pro" },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "kimi-fireworks": {
    implementer: {
      model: "fireworks-ai/accounts/fireworks/models/kimi-k2p7-code",
    },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
  "kimi-fireworks-fast": {
    implementer: {
      model: "fireworks-ai/accounts/fireworks/routers/kimi-k2p7-code-fast",
    },
    advisor: { model: "openai/gpt-5.6-sol", variant: "xhigh" },
  },
};

let openCodeLauncher = "direct";

function openCodeCommand(args) {
  return openCodeLauncher === "notion-local"
    ? ["notion", "local", "opencode", ...args]
    : ["opencode", ...args];
}

const ADVISOR_SYSTEM =
  "You are a senior advisor to a coding agent (the executor). " +
  "You are given the executor's full conversation transcript and, optionally, a specific focus. " +
  "Provide concise strategic guidance: a plan, a course correction, or the key design " +
  "decision and pitfalls to avoid. Do NOT write the full implementation; the executor " +
  "will carry it out. Be direct and specific. Keep it under 300 words.";
const ADVISOR_FOCUS =
  "Audit correctness, causal completeness, repair safety, and test coverage; prioritize only material changes.";
const PLANNING_ADVISOR_FOCUS =
  "Audit whether the plan is source-grounded, dependency-ordered, complete enough to execute safely, explicit about trust boundaries and verification, and clear about hard stops; prioritize only material changes.";
const PROTOCOL = "staged-draft-review-revision-v1";
const DIRECT_PROTOCOL = "read-only-production-forensics-v1";
const PLANNING_PROTOCOL = "read-only-production-planning-v1";
const PLANNING_REVIEW_PROTOCOL = "staged-production-planning-review-v2";
const LEGACY_DRAFT_RUNNER_SHA256S = [
  "086f0ed8723ceab319801fc9a6cd80f56dd3f2484f62620376778971e8f7c6b7",
  "855ed38345232bc022c23ed2a31ac749f7a9fc18fec1f894d9b5edd348af3b9a",
];
const LEGACY_TRIAL_RUNNER_SHA256S = [...LEGACY_DRAFT_RUNNER_SHA256S];
const MESSAGE_TRUNCATE_MAX = 4000;
const TRANSCRIPT_CHAR_BUDGET = 60000;
const LEGACY_CONTROLLER_STEPS = 100;
const ADVISOR_STEPS = 4;
const REQUEST_TIMEOUT_MS = benchmarkTimeout(
  "OPENCODE_BENCHMARK_REQUEST_TIMEOUT_MS",
  60 * 60 * 1000,
);
const DIRECT_REQUEST_TIMEOUT_MS = benchmarkTimeout(
  "OPENCODE_BENCHMARK_DIRECT_REQUEST_TIMEOUT_MS",
  REQUEST_TIMEOUT_MS,
);
const TERMINATION_GRACE_MS = 5000;

function benchmarkTimeout(environmentVariable, fallback) {
  const value = Number(process.env[environmentVariable] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${environmentVariable} must be a positive number of milliseconds`);
  }
  return value;
}

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

function createBenchmarkConfig(cwd, { controllerSteps } = {}) {
  return benchmarkConfigWithProviders(cwd, {
    snapshot: false,
    share: "disabled",
    mcp: {},
    agent: {
      benchmark_controller: {
        mode: "primary",
        ...(controllerSteps === undefined ? {} : { steps: controllerSteps }),
        permission: {
          "*": "deny",
          read: {
            "*": "allow",
            ".git": "deny",
            ".git/**": "deny",
            "**/.git/**": "deny",
            ".env": "deny",
            ".env.*": "deny",
            "*.env": "deny",
            "*.env.*": "deny",
          },
          glob: "allow",
          grep: "allow",
          external_directory: "deny",
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
      external_directory: "deny",
    },
  });
}

function usage() {
  console.error(
    "Usage: benchmark-opencode-model-pairs.mjs --task-file PATH --round NAME --output-dir PATH --combos NAME[,NAME...] [--rubric-file PATH] [--workdir PATH] [--seed VALUE] [--repeat N] [--concurrency N] [--opencode-launcher direct|notion-local] [--draft-only true|false] [--planning-only true|false] [--validate-only true|false]",
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
  for (const name of ["draft_only", "planning_only", "validate_only"]) {
    if (result[name] !== undefined) {
      if (!["true", "false"].includes(String(result[name]))) {
        throw new Error(`--${name.replaceAll("_", "-")} must be true or false`);
      }
      result[name] = String(result[name]) === "true";
    } else {
      result[name] = false;
    }
  }
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

function canonicalPath(candidate) {
  let existingAncestor = path.resolve(candidate);
  const missingSegments = [];
  while (!fs.existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) return path.resolve(candidate);
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  return path.join(fs.realpathSync(existingAncestor), ...missingSegments);
}

export function assertToolPathsStayInWorkdir(events, cwd) {
  const root = canonicalPath(cwd);
  const rootPrefix = `${root}${path.sep}`;
  const pathKeys = new Set(["directory", "filePath", "path", "workdir"]);
  for (const event of events) {
    if (event.type !== "tool_use") continue;
    const input = event.part?.state?.input;
    if (!input || typeof input !== "object") continue;
    for (const [key, value] of Object.entries(input)) {
      const isGlobPattern = event.part?.tool === "glob" && key === "pattern";
      if ((!pathKeys.has(key) && !isGlobPattern) || typeof value !== "string") {
        continue;
      }
      if (value.startsWith("~") || /(^|[\\/])\.\.([\\/]|$)/u.test(value)) {
        throw new Error(`Benchmark tool attempted path traversal: ${value}`);
      }
      const pathValue = isGlobPattern
        ? value.split(/[*?{[]/u, 1)[0]
        : value;
      const resolved = canonicalPath(path.resolve(cwd, pathValue || "."));
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
  const result = Bun.spawnSync(openCodeCommand(["--version"]), {
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
const modelRouteCache = new Map();
let catalogRuntime;

function catalogRuntimePaths() {
  if (catalogRuntime) return catalogRuntime;
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-benchmark-catalog-"));
  fs.chmodSync(root, 0o700);
  const cwd = path.join(root, "workspace");
  const configHome = path.join(root, "config");
  const dataHome = path.join(root, "data");
  ensurePrivateDirectory(cwd);
  ensurePrivateDirectory(path.join(configHome, "opencode"));
  ensurePrivateDirectory(path.join(dataHome, "opencode"));
  catalogRuntime = { cwd, configHome, dataHome };
  process.once("exit", () => fs.rmSync(root, { recursive: true, force: true }));
  return catalogRuntime;
}

function verboseModelCatalog(cwd, provider) {
  const key = `${openCodeLauncher}:${provider}`;
  if (modelCatalogHashCache.has(`${key}:source`)) {
    return modelCatalogHashCache.get(`${key}:source`);
  }
  const runtime = catalogRuntimePaths();
  const catalog = commandText(
    openCodeCommand(["models", provider, "--verbose"]),
    runtime.cwd,
    isolatedOpenCodeEnvironment({
      configContent: createBenchmarkConfig(cwd),
      configHome: runtime.configHome,
      dataHome: runtime.dataHome,
      authContent: "{}",
      cwd: runtime.cwd,
    }),
  );
  modelCatalogHashCache.set(`${key}:source`, catalog);
  return catalog;
}

function modelCatalogHash(cwd, model) {
  const provider = model.split("/", 1)[0];
  const key = `${openCodeLauncher}:${provider}:legacy-hash`;
  if (modelCatalogHashCache.has(key)) return modelCatalogHashCache.get(key);
  const catalog = verboseModelCatalog(cwd, provider);
  const hash = createHash("sha256").update(catalog).digest("hex");
  modelCatalogHashCache.set(key, hash);
  return hash;
}

function modelRouteProvenance(cwd, selection) {
  const key = `${openCodeLauncher}:${selection.model}:${selection.variant ?? "default"}`;
  if (modelRouteCache.has(key)) return modelRouteCache.get(key);
  const provider = selection.model.split("/", 1)[0];
  const route = resolveBenchmarkModelRoute(
    verboseModelCatalog(cwd, provider),
    selection,
  );
  modelRouteCache.set(key, route);
  return route;
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

export function benchmarkRepetitionProvenance({
  round,
  seed,
  repetition,
  concurrency,
  executionOrder,
  runnerSha256 = RUNNER_SHA256,
}) {
  return {
    round,
    seed: String(seed),
    repetition,
    concurrency,
    execution_order: [...executionOrder],
    runner_sha256: runnerSha256,
  };
}

function draftFingerprintWithRunnerSha({
  cwd,
  task,
  implementer,
  protocol = PROTOCOL,
  runnerSha256,
}) {
  return createHash("sha256").update(JSON.stringify({
    schema: 4,
    protocol,
    cwd,
    task,
    implementer,
    benchmark_config: createBenchmarkConfig(cwd, {
      controllerSteps: LEGACY_CONTROLLER_STEPS,
    }),
    opencode_version: openCodeVersion(),
    repository: repositoryMetadata(cwd),
    model_catalog_sha256: modelCatalogHash(cwd, implementer.model),
    runner_sha256: runnerSha256,
  })).digest("hex");
}

function draftFingerprint({
  cwd,
  task,
  implementer,
  protocol = PROTOCOL,
  provenance,
}) {
  return createHash("sha256").update(JSON.stringify({
    schema: 7,
    protocol,
    cwd,
    task,
    implementer,
    provenance,
    benchmark_config: createBenchmarkConfig(cwd),
    opencode_version: openCodeVersion(),
    repository: repositoryMetadata(cwd),
    model_route_sha256: modelRouteProvenance(cwd, implementer).sha256,
    runner_sha256: RUNNER_SHA256,
  })).digest("hex");
}

function compatibleLegacyDraftFingerprints({ cwd, task, implementer, protocol }) {
  return LEGACY_DRAFT_RUNNER_SHA256S.map((runnerSha256) =>
    draftFingerprintWithRunnerSha({
      cwd,
      task,
      implementer,
      protocol,
      runnerSha256,
    }));
}

function trialFingerprintWithRunnerSha({
  cwd,
  task,
  combinationName,
  repetition,
  draft,
  transcriptSha256,
  protocol = PROTOCOL,
  runnerSha256,
}) {
  const combination = combinations[combinationName];
  return createHash("sha256").update(JSON.stringify({
    schema: 1,
    protocol,
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
    benchmark_config: createBenchmarkConfig(cwd, {
      controllerSteps: LEGACY_CONTROLLER_STEPS,
    }),
    opencode_version: openCodeVersion(),
    repository: repositoryMetadata(cwd),
    model_catalog_sha256: {
      implementer: modelCatalogHash(cwd, combination.implementer.model),
      advisor: combination.advisor
        ? modelCatalogHash(cwd, combination.advisor.model)
        : undefined,
    },
    runner_sha256: runnerSha256,
  })).digest("hex");
}

function trialFingerprint({
  cwd,
  task,
  combinationName,
  repetition,
  draft,
  transcriptSha256,
  protocol = PROTOCOL,
  provenance,
  planningOnly = false,
}) {
  const combination = combinations[combinationName];
  return createHash("sha256").update(JSON.stringify({
    schema: 3,
    protocol,
    cwd,
    task,
    combination_name: combinationName,
    combination,
    repetition,
    provenance,
    planning_only: planningOnly,
    draft_fingerprint: draft.fingerprint,
    draft_session_id: draft.session_id,
    transcript_sha256: transcriptSha256,
    advisor_system: ADVISOR_SYSTEM,
    advisor_focus: planningOnly ? PLANNING_ADVISOR_FOCUS : ADVISOR_FOCUS,
    benchmark_config: createBenchmarkConfig(cwd),
    opencode_version: openCodeVersion(),
    repository: repositoryMetadata(cwd),
    model_route_sha256: {
      implementer: modelRouteProvenance(cwd, combination.implementer).sha256,
      advisor: combination.advisor
        ? modelRouteProvenance(cwd, combination.advisor).sha256
        : undefined,
    },
    runner_sha256: RUNNER_SHA256,
  })).digest("hex");
}

function compatibleLegacyTrialFingerprints({
  cwd,
  task,
  combinationName,
  repetition,
  draft,
  transcriptSha256,
  protocol,
}) {
  return LEGACY_TRIAL_RUNNER_SHA256S.map((runnerSha256) =>
    trialFingerprintWithRunnerSha({
      cwd,
      task,
      combinationName,
      repetition,
      draft,
      transcriptSha256,
      protocol,
      runnerSha256,
    }));
}

function summarize(events, wallTimeMs, model, invocationStartedAtMs) {
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
    timing: summarizeEventTiming(events, invocationStartedAtMs),
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

async function runOpenCode({
  cwd,
  model,
  variant,
  agent,
  title,
  prompt,
  dataHome,
  authState,
  session,
  fork = false,
  requestTimeoutMs = REQUEST_TIMEOUT_MS,
}) {
  const configHome = path.join(path.dirname(dataHome), "xdg-config");
  ensurePrivateDirectory(path.join(configHome, "opencode"));
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

  const startedAtEpochMs = Date.now();
  const startedAt = performance.now();
  const child = Bun.spawn(openCodeCommand(args), {
    cwd,
    env: isolatedOpenCodeEnvironment({
      configContent: createBenchmarkConfig(cwd),
      configHome,
      dataHome,
      authContent: authState.content,
      cwd,
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let forceKillTimeout;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKillTimeout = setTimeout(() => child.kill("SIGKILL"), TERMINATION_GRACE_MS);
  }, requestTimeoutMs);
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
  let policyViolation;
  try {
    assertToolPathsStayInWorkdir(events, cwd);
  } catch (error) {
    policyViolation = error.message;
  }
  const sessionID = events.find((event) => event.sessionID)?.sessionID;
  const completed = events.some(
    (event) => event.type === "step_finish" && event.part?.reason === "stop",
  );
  const status = policyViolation
    ? "policy_violation"
    : timedOut
    ? "timeout"
    : exitCode !== 0
      ? "failed"
      : completed
        ? "completed"
        : "incomplete";
  const metrics = summarize(events, wallTimeMs, model, startedAtEpochMs);
  metrics.cost_completeness = status === "completed"
    ? "complete_for_observed_requests"
    : "completed_requests_lower_bound";
  return {
    status,
    exit_code: exitCode,
    session_id: sessionID,
    text: extractText(events),
    metrics,
    events,
    error: policyViolation ?? (exitCode === 0 ? undefined : (errorOutput || output.slice(-2000))),
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
    cost_completeness: stages.every(
      (stage) => stage.metrics.cost_completeness === "complete_for_observed_requests",
    )
      ? "complete_for_observed_requests"
      : "completed_requests_lower_bound",
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

function validatedStageArtifacts(directory, name, stage, cwd, model) {
  if (!model) throw new Error(`${name} validation requires its executing model`);
  const eventsPath = path.join(directory, `${name}.jsonl`);
  const textPath = path.join(directory, `${name}.md`);
  if (!fs.existsSync(eventsPath) || !fs.existsSync(textPath)) {
    throw new Error(`${name} raw artifacts are incomplete`);
  }
  const rawEvents = fs.readFileSync(eventsPath, "utf8");
  if (!rawEvents.endsWith("\n")) {
    throw new Error(`${name} event log is not atomically complete`);
  }
  const events = parseEvents(rawEvents);
  assertToolPathsStayInWorkdir(events, cwd);
  if (!events.some(
    (event) => event.type === "step_finish" && event.part?.reason === "stop",
  )) {
    throw new Error(`${name} event log has no completed terminal step`);
  }
  const eventSessionIDs = new Set(
    events.map((event) => event.sessionID).filter(Boolean),
  );
  if (
    !stage.session_id ||
    eventSessionIDs.size !== 1 ||
    !eventSessionIDs.has(stage.session_id)
  ) {
    throw new Error(`${name} event log does not match its saved session`);
  }
  const eventText = extractText(events);
  const artifactText = fs.readFileSync(textPath, "utf8").trim();
  if (eventText !== stage.text?.trim() || artifactText !== stage.text?.trim()) {
    throw new Error(`${name} text does not match its raw event log`);
  }
  const metrics = summarize(
    events,
    Number(stage.metrics?.wall_time_seconds ?? 0) * 1000,
    model,
  );
  metrics.cost_completeness = "complete_for_observed_requests";
  return { events, metrics };
}

function sessionTranscript(sessionID, dataHome) {
  const messages = loadSessionMessages(sessionID, dataHome);
  if (messages.length === 0) {
    throw new Error(`Draft session has no messages: ${sessionID}`);
  }
  const text = serializeTranscript(messages);
  return {
    text,
    sha256: createHash("sha256").update(text).digest("hex"),
  };
}

function freezeDraftTranscript({ draftDir, draft, dataHome }) {
  const snapshot = sessionTranscript(draft.session_id, dataHome);
  const hashPath = path.join(draftDir, "draft-transcript.sha256");
  const persistedHash = fs.existsSync(hashPath)
    ? fs.readFileSync(hashPath, "utf8").trim()
    : undefined;
  if (persistedHash && !/^[a-f0-9]{64}$/u.test(persistedHash)) {
    throw new Error("draft transcript hash is malformed");
  }
  if (
    (draft.transcript_sha256 && draft.transcript_sha256 !== snapshot.sha256) ||
    (persistedHash && persistedHash !== snapshot.sha256)
  ) {
    throw new Error("draft session transcript changed after the artifact was frozen");
  }
  if (!persistedHash) {
    writePrivateFile(hashPath, `${snapshot.sha256}\n`);
  }
  return snapshot;
}

function decisionEligible(status) {
  return status === "completed";
}

function validatedArtifactOrigin({
  metadata,
  draftManifest,
  round,
  provenance,
  repetition,
  implementer,
  combinationName,
  fingerprint,
  sessionID,
}) {
  if (!metadata) {
    throw new Error("legacy artifact has no preserved origin metadata");
  }
  const originOrder = metadata.execution_order?.[`repetition_${repetition}`];
  if (
    metadata.round !== round ||
    String(metadata.seed) !== String(provenance.seed) ||
    metadata.concurrency !== provenance.concurrency ||
    !Number.isInteger(metadata.repeat) ||
    metadata.repeat < repetition ||
    !Array.isArray(originOrder)
  ) {
    throw new Error(
      "legacy artifact origin does not match round, seed, repetition, or concurrency",
    );
  }
  let sourceRoute;
  if (combinationName) {
    if (!originOrder.includes(combinationName)) {
      throw new Error(`legacy trial origin does not contain route ${combinationName}`);
    }
    sourceRoute = combinationName;
  } else {
    sourceRoute = originOrder.find((route) =>
      JSON.stringify(combinations[route]?.implementer) === JSON.stringify(implementer)
    );
    if (!sourceRoute) {
      throw new Error("legacy draft origin does not contain its implementer route");
    }
    const sourceDraft = draftManifest?.find((candidate) =>
      candidate.repetition === repetition &&
      JSON.stringify(candidate.implementer) === JSON.stringify(implementer) &&
      candidate.fingerprint === fingerprint &&
      candidate.session_id === sessionID
    );
    if (!sourceDraft) {
      throw new Error("legacy draft does not match its origin repetition manifest");
    }
  }
  return {
    round: metadata.round,
    seed: String(metadata.seed),
    repetition,
    concurrency: metadata.concurrency,
    execution_order: [...originOrder],
    source_route: sourceRoute,
    runner_sha256: metadata.runner_sha256 ?? null,
    fingerprint,
    session_id: sessionID,
  };
}

function draftManifest(results) {
  const drafts = new Map();
  for (const result of results ?? []) {
    const draft = result.stages?.draft;
    if (!draft?.fingerprint || !draft.session_id) continue;
    const entry = {
      repetition: result.repetition,
      implementer: result.implementer,
      fingerprint: draft.fingerprint,
      session_id: draft.session_id,
    };
    const identity = JSON.stringify(entry);
    drafts.set(identity, entry);
  }
  return [...drafts.values()];
}

function frozenDraftFingerprint({
  metadata,
  cwd,
  task,
  implementer,
  protocol,
  repetition,
}) {
  const originOrder = metadata?.execution_order?.[`repetition_${repetition}`];
  const originProtocol = metadata?.draft_protocol ?? metadata?.protocol;
  if (
    metadata?.runner_sha256 !== RUNNER_SHA256 ||
    originProtocol !== protocol ||
    !Array.isArray(originOrder)
  ) {
    return undefined;
  }
  return draftFingerprint({
    cwd,
    task,
    implementer,
    protocol,
    provenance: benchmarkRepetitionProvenance({
      round: metadata.round,
      seed: String(metadata.seed),
      repetition,
      concurrency: metadata.concurrency,
      executionOrder: originOrder,
      runnerSha256: metadata.runner_sha256,
    }),
  });
}

function validatedSummarySource({ summaryFile, round, planningOnly, rubricFile }) {
  const summaryPath = path.resolve(summaryFile);
  const summaryContents = fs.readFileSync(summaryPath, "utf8");
  const results = JSON.parse(summaryContents);
  if (!Array.isArray(results) || results.length === 0) {
    throw new Error("--summary-file must contain a non-empty result array");
  }
  if (results.some((result) => result.round !== round)) {
    throw new Error("--summary-file results do not all match --round");
  }
  const metadataPath = path.join(path.dirname(summaryPath), `${round}-metadata.json`);
  if (!fs.existsSync(metadataPath)) {
    throw new Error("--summary-file has no sibling benchmark metadata");
  }
  const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  if (metadata.round !== round) {
    throw new Error("summary metadata does not match --round");
  }
  if (Boolean(metadata.planning_only) !== planningOnly) {
    throw new Error("summary metadata does not match --planning-only");
  }
  const rubricSha256 = createHash("sha256")
    .update(fs.readFileSync(path.resolve(rubricFile)))
    .digest("hex");
  if (metadata.rubric_sha256 !== rubricSha256) {
    throw new Error("summary metadata does not match the supplied rubric");
  }
  const summarySha256 = createHash("sha256").update(summaryContents).digest("hex");
  if (metadata.summary_sha256 !== summarySha256) {
    throw new Error("summary contents do not match their bound metadata hash");
  }
  if (metadata.summary_result_count !== results.length) {
    throw new Error("summary result count does not match its metadata");
  }
  return { results, metadata, summarySha256 };
}

function writeGradingPacket({
  outputDir,
  round,
  results,
  rubricFile,
  seed,
  planningOnly = false,
}) {
  if (!rubricFile) return;

  const rubric = fs.readFileSync(path.resolve(rubricFile), "utf8").trim();
  const candidates = [];
  const seenDrafts = new Set();
  for (const result of results) {
    const draft = result.stages.draft;
    const draftIdentity = draft.session_id ??
      `${draft.fingerprint ?? JSON.stringify(result.implementer)}:${result.round ?? "unknown"}:r${result.repetition}`;
    if (
      draft.text &&
      decisionEligible(draft.status) &&
      !seenDrafts.has(draftIdentity)
    ) {
      seenDrafts.add(draftIdentity);
      candidates.push({
        kind: "unreviewed_draft",
        source: "draft",
        execution_status: draft.status,
        eligible_for_decision: decisionEligible(draft.status),
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
        kind: result.review_mode === "self_review"
          ? "self_revised_final"
          : "advisor_revised_final",
        source: "final",
        execution_status: result.status,
        eligible_for_decision: decisionEligible(result.status),
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
    planningOnly
      ? `Blind-grade every Markdown file in answers/. Treat labels as opaque. Use rubric.md as the fixed ground truth. Score source grounding, implementation-map completeness, dependency ordering, correctness mechanisms, trust boundaries, verification, stop conditions, and calibrated uncertainty. Report material errors, any rubric cap, a weighted 0-100 score, and a rank order. Do not inspect key.json until grading is final.\n`
      : `Blind-grade every Markdown file in answers/. Treat labels as opaque. Use rubric.md as the fixed ground truth. Score factual correctness, causal completeness, source evidence, repair safety, test design, and calibrated uncertainty. Report material errors, any rubric cap, a weighted 0-100 score, and a rank order. Do not inspect key.json until grading is final.\n`,
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
    cost_completeness: stages.every(
      (stage) => stage.metrics.cost_completeness === "complete_for_observed_requests",
    )
      ? "complete_for_observed_requests"
      : "completed_requests_lower_bound",
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

async function runDraft({
  cwd,
  task,
  round,
  outputDir,
  implementer,
  repetition,
  dataHome,
  authState,
  protocol = PROTOCOL,
  planningOnly = false,
  provenance,
  legacyOriginMetadata,
  legacyOriginDrafts,
  frozenOriginMetadata,
  frozenOriginDrafts,
}) {
  const key = implementerKey(implementer);
  const fingerprint = draftFingerprint({
    cwd,
    task,
    implementer,
    protocol,
    provenance,
  });
  const legacyFingerprints = new Set(
    legacyOriginMetadata?.concurrency === provenance.concurrency
      ? compatibleLegacyDraftFingerprints({
        cwd,
        task,
        implementer,
        protocol,
      })
      : [],
  );
  const compatibleFrozenFingerprint = frozenDraftFingerprint({
    metadata: frozenOriginMetadata,
    cwd,
    task,
    implementer,
    protocol,
    repetition,
  });
  const compatibleFingerprints = new Set([
    fingerprint,
    ...legacyFingerprints,
    ...(compatibleFrozenFingerprint ? [compatibleFrozenFingerprint] : []),
  ]);
  const draftDir = path.join(outputDir, `${round}-${key}-r${repetition}-draft`);
  ensurePrivateDirectory(draftDir);
  const resultPath = path.join(draftDir, "result.json");
  if (fs.existsSync(resultPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(resultPath, "utf8"));
      if (
        saved.status === "completed" &&
        saved.session_id &&
        compatibleFingerprints.has(saved.fingerprint) &&
        sessionExists(saved.session_id, dataHome)
      ) {
        const { events, metrics } = validatedStageArtifacts(
          draftDir,
          "draft",
          saved,
          cwd,
          implementer.model,
        );
        const legacy = legacyFingerprints.has(saved.fingerprint);
        const frozen = saved.fingerprint === compatibleFrozenFingerprint &&
          saved.fingerprint !== fingerprint;
        const origin = legacy || frozen
          ? validatedArtifactOrigin({
            metadata: legacy ? legacyOriginMetadata : frozenOriginMetadata,
            draftManifest: legacy ? legacyOriginDrafts : frozenOriginDrafts,
            round,
            provenance,
            repetition,
            implementer,
            fingerprint: saved.fingerprint,
            sessionID: saved.session_id,
          })
          : saved.artifact_provenance?.origin ?? provenance;
        const transcript = freezeDraftTranscript({
          draftDir,
          draft: saved,
          dataHome,
        });
        const reuseLabel = legacy
          ? " (validated legacy fingerprint)"
          : frozen
            ? " (validated frozen draft)"
            : "";
        console.log(
          `REUSE  ${round}-${key}-r${repetition}${reuseLabel}`,
        );
        return {
          ...saved,
          events,
          metrics,
          transcript_sha256: transcript.sha256,
          transcript_chars: transcript.text.length,
          artifact_provenance: legacy || frozen
            ? {
              origin,
              reused_in: provenance,
              reused_legacy_fingerprint: legacy,
              reused_frozen_draft: frozen,
            }
            : saved.artifact_provenance ?? {
              origin,
              reused_legacy_fingerprint: false,
              reused_frozen_draft: false,
            },
        };
      }
      if (saved.status === "completed" && compatibleFingerprints.has(saved.fingerprint)) {
        console.log(`STALE  ${round}-${key}-r${repetition} (session unavailable)`);
      }
    } catch {
      console.log(`STALE  ${round}-${key}-r${repetition} (invalid saved result)`);
    }
  }
  console.log(`DRAFT  ${round}-${key}-r${repetition}`);
  fs.rmSync(path.join(draftDir, "draft-transcript.sha256"), { force: true });
  const assignment = planningOnly
    ? "Produce an implementation plan for an independent executor. Do not implement the task or provide a full patch. Make the plan concrete enough that the executor does not need to invent missing correctness mechanisms, sequencing, verification, or stop conditions."
    : "Complete the requested read-only source analysis.";
  const prompt = `Controlled iOS controller benchmark. Read every applicable AGENTS.md first. Copied benchmark skills are available only inside this artifact; do not access ~ or any path outside the workdir. Do not edit or write files, install anything, run builds or tests, call an advisor, or delegate to a subagent. Work independently.\n\n${assignment}\n\n${task}\n\nReturn a source-grounded draft under 1,200 words in the requested structure. Cite path:line evidence and distinguish verified facts from inference.`;
  const draft = await runOpenCode({
    cwd,
    ...implementer,
    agent: "benchmark_controller",
    title: `${round}-${key}-r${repetition}-draft`,
    prompt,
    dataHome,
    authState,
    requestTimeoutMs: protocol === DIRECT_PROTOCOL
      ? DIRECT_REQUEST_TIMEOUT_MS
      : REQUEST_TIMEOUT_MS,
  });
  draft.fingerprint = fingerprint;
  draft.artifact_provenance = {
    origin: provenance,
    reused_legacy_fingerprint: false,
    reused_frozen_draft: false,
  };
  writeStage(draftDir, "draft", draft);
  if (draft.status === "completed" && draft.session_id) {
    const transcript = freezeDraftTranscript({ draftDir, draft, dataHome });
    draft.transcript_sha256 = transcript.sha256;
    draft.transcript_chars = transcript.text.length;
  }
  writePrivateFile(
    path.join(draftDir, "result.json"),
    `${JSON.stringify(withoutEvents(draft), null, 2)}\n`,
  );
  console.log(
    `DRAFT  ${draft.status.padEnd(10)} ${round}-${key}-r${repetition} ${draft.metrics.wall_time_seconds.toFixed(1)}s $${draft.metrics.recomputed_cost_usd.toFixed(4)} ${draft.metrics.tool_calls} tools`,
  );
  return draft;
}

function savedTrialMatchesCurrentInputs({
  saved,
  trialName,
  round,
  repetition,
  combinationName,
  combination,
  draft,
  transcriptSha256,
  compatibleFingerprints,
  legacyFingerprints,
}) {
  const sameAdvisor = JSON.stringify(saved.advisor) === JSON.stringify(combination.advisor);
  const expectedReviewMode = combination.review_mode === "self_review"
    ? "self_review"
    : "external_advisor";
  const compatibleReviewMode = saved.review_mode === expectedReviewMode || (
    saved.review_mode === undefined && legacyFingerprints.has(saved.fingerprint)
  );
  return saved.status === "completed" &&
    compatibleFingerprints.has(saved.fingerprint) &&
    compatibleReviewMode &&
    saved.trial === trialName &&
    saved.round === round &&
    saved.repetition === repetition &&
    saved.combination === combinationName &&
    JSON.stringify(saved.implementer) === JSON.stringify(combination.implementer) &&
    sameAdvisor &&
    saved.stages?.draft?.session_id === draft.session_id &&
    saved.stages?.draft?.fingerprint === draft.fingerprint &&
    saved.stages?.final?.status === "completed" &&
    (combination.review_mode === "self_review" || (
      saved.stages?.advice?.status === "completed" &&
      saved.stages.advice.transcript_sha256 === transcriptSha256
    ));
}

async function runTrial({
  cwd,
  task,
  round,
  outputDir,
  combinationName,
  repetition,
  draft,
  dataHome,
  authState,
  protocol = PROTOCOL,
  planningOnly = false,
  provenance,
  legacyOriginMetadata,
}) {
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
      review_mode: combination.review_mode === "self_review"
        ? "self_review"
        : "external_advisor",
      advisor_mechanism: combination.review_mode === "self_review"
        ? "none_independent_self_review"
        : "transcript_fed_toolless_automatic_review",
      eligible_for_decision: false,
      artifact_provenance: {
        origin: provenance,
        reused_legacy_fingerprint: false,
      },
      stages: { draft: withoutEvents(draft) },
      totals: trialTotals([draft]),
    };
    writePrivateFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`FAIL   ${trialName} (${draft.status} draft)`);
    return result;
  }

  const draftDir = path.join(
    outputDir,
    `${round}-${implementerKey(combination.implementer)}-r${repetition}-draft`,
  );
  const transcriptSnapshot = freezeDraftTranscript({ draftDir, draft, dataHome });
  const transcript = transcriptSnapshot.text;
  const transcriptSha256 = transcriptSnapshot.sha256;
  const fingerprint = trialFingerprint({
    cwd,
    task,
    combinationName,
    repetition,
    draft,
    transcriptSha256,
    protocol,
    provenance,
    planningOnly,
  });
  const legacyFingerprints = new Set(compatibleLegacyTrialFingerprints({
    cwd,
    task,
    combinationName,
    repetition,
    draft,
    transcriptSha256,
    protocol,
  }));
  const compatibleFingerprints = new Set([fingerprint, ...legacyFingerprints]);
  if (fs.existsSync(resultPath)) {
    try {
      const saved = JSON.parse(fs.readFileSync(resultPath, "utf8"));
      if (savedTrialMatchesCurrentInputs({
        saved,
        trialName,
        round,
        repetition,
        combinationName,
        combination,
        draft,
        transcriptSha256,
        compatibleFingerprints,
        legacyFingerprints,
      })) {
        const validatedDraft = validatedStageArtifacts(
          trialDir,
          "draft",
          saved.stages.draft,
          cwd,
          combination.implementer.model,
        );
        let validatedAdvice;
        if (combination.review_mode !== "self_review") {
          validatedAdvice = validatedStageArtifacts(
            trialDir,
            "advice",
            saved.stages.advice,
            cwd,
            combination.advisor.model,
          );
        }
        const validatedFinal = validatedStageArtifacts(
          trialDir,
          "final",
          saved.stages.final,
          cwd,
          combination.implementer.model,
        );
        const stages = {
          draft: {
            ...saved.stages.draft,
            metrics: validatedDraft.metrics,
          },
          ...(validatedAdvice
            ? {
              advice: {
                ...saved.stages.advice,
                metrics: validatedAdvice.metrics,
              },
            }
            : {}),
          final: {
            ...saved.stages.final,
            metrics: validatedFinal.metrics,
          },
        };
        const orderedStages = combination.review_mode === "self_review"
          ? [stages.draft, stages.final]
          : [stages.draft, stages.advice, stages.final];
        const legacy = legacyFingerprints.has(saved.fingerprint);
        const origin = legacy
          ? validatedArtifactOrigin({
            metadata: legacyOriginMetadata,
            round,
            provenance,
            repetition,
            implementer: combination.implementer,
            combinationName,
            fingerprint: saved.fingerprint,
          })
          : saved.artifact_provenance?.origin ?? provenance;
        console.log(
          `REUSE  ${trialName}${legacy ? " (validated legacy fingerprint)" : ""}`,
        );
        return {
          ...saved,
          stages,
          totals: trialTotals(orderedStages),
          review_mode: combination.review_mode === "self_review"
            ? "self_review"
            : "external_advisor",
          advisor_mechanism: combination.review_mode === "self_review"
            ? "none_independent_self_review"
            : "transcript_fed_toolless_automatic_review",
          eligible_for_decision: true,
          artifact_provenance: legacy
            ? {
              origin,
              reused_in: provenance,
              reused_legacy_fingerprint: true,
            }
            : saved.artifact_provenance ?? {
              origin,
              reused_legacy_fingerprint: false,
            },
        };
      }
    } catch {
      console.log(`STALE  ${trialName} (invalid saved result)`);
    }
  }

  console.log(`START  ${trialName}`);
  writeStage(trialDir, "draft", draft);
  if (combination.review_mode === "self_review") {
    const reviewFocus = planningOnly
      ? "source grounding, dependency ordering, implementation completeness, trust boundaries, verification, stop conditions, and calibrated uncertainty"
      : "correctness, causal completeness, repair safety, test design, and calibrated uncertainty";
    const finalPrompt = `Take one independent self-review pass over the draft. Re-check it against the repository evidence and the original task, then revise only where doing so materially improves ${reviewFocus}. Do not edit files, run builds/tests, call an advisor, or delegate. Return the final answer under 1,200 words in the original task's requested structure, with precise path:line citations and explicit uncertainty.`;
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
      review_mode: "self_review",
      advisor_mechanism: "none_independent_self_review",
      eligible_for_decision: decisionEligible(final.status),
      artifact_provenance: {
        origin: provenance,
        reused_legacy_fingerprint: false,
      },
      implementer: combination.implementer,
      stages: {
        draft: withoutEvents(draft),
        final: withoutEvents(final),
      },
      totals: trialTotals([draft, final]),
    };
    writePrivateFile(resultPath, `${JSON.stringify(result, null, 2)}\n`);
    console.log(
      `${result.status === "completed" ? "DONE" : "FAIL"}   ${trialName} ${result.totals.wall_time_seconds.toFixed(1)}s $${result.totals.recomputed_cost_usd.toFixed(4)} ${result.totals.tool_calls} tools`,
    );
    return result;
  }

  const advisorPrompt =
    `## Conversation transcript so far\n${transcript}\n\n` +
    `---\nExecutor's current focus: ${planningOnly ? PLANNING_ADVISOR_FOCUS : ADVISOR_FOCUS}\n\n` +
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
      review_mode: "external_advisor",
      advisor_mechanism: "transcript_fed_toolless_automatic_review",
      eligible_for_decision: false,
      artifact_provenance: {
        origin: provenance,
        reused_legacy_fingerprint: false,
      },
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

  const reconciliation = planningOnly
    ? "Reconcile it against the source evidence and original planning constraints; preserve dependency ordering, concrete correctness mechanisms, verification, and hard stops, and do not accept the advice blindly."
    : "Reconcile it against the evidence; do not accept it blindly.";
  const finalPrompt = `The single permitted advisor tool returned the result below. ${reconciliation} Do not edit files, run builds/tests, call an advisor, or delegate. Return the final answer under 1,200 words in the original task's requested structure, with precise path:line citations and explicit uncertainty.\n\n[tool: advisor] -> ${advice.text}`;
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
    review_mode: "external_advisor",
    advisor_mechanism: "transcript_fed_toolless_automatic_review",
    eligible_for_decision: decisionEligible(final.status),
    artifact_provenance: {
      origin: provenance,
      reused_legacy_fingerprint: false,
    },
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
  openCodeLauncher = args.opencode_launcher ?? "direct";
  if (!["direct", "notion-local"].includes(openCodeLauncher)) {
    throw new Error("--opencode-launcher must be direct or notion-local");
  }
  if (args.round) validateRoundName(args.round);
  if (args.summary_file) {
    for (const required of ["round", "output_dir", "rubric_file"]) {
      if (!args[required]) {
        usage();
        throw new Error(`Missing --${required.replaceAll("_", "-")}`);
      }
    }
    let outputDir = assertRawBenchmarkOutputOutsideRepository(args.output_dir);
    ensurePrivateDirectory(outputDir);
    outputDir = assertRawBenchmarkOutputOutsideRepository(outputDir);
    const { results } = validatedSummarySource({
      summaryFile: args.summary_file,
      round: args.round,
      planningOnly: args.planning_only,
      rubricFile: args.rubric_file,
    });
    writeGradingPacket({
      outputDir,
      round: args.round,
      results,
      rubricFile: args.rubric_file,
      seed: `${args.seed}:grading:${args.round}`,
      planningOnly: args.planning_only,
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
  if (!Number.isInteger(args.concurrency) || args.concurrency < 1) {
    throw new Error("--concurrency must be a positive integer");
  }
  if (args.concurrency !== 1 && !args.draft_only) {
    throw new Error(
      "--concurrency greater than 1 is supported only for independent draft-only routes",
    );
  }

  let outputDir = assertRawBenchmarkOutputOutsideRepository(args.output_dir);
  ensurePrivateDirectory(outputDir);
  outputDir = assertRawBenchmarkOutputOutsideRepository(outputDir);

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
  if (args.draft_only) {
    const implementers = selected.map((name) => implementerKey(combinations[name].implementer));
    if (new Set(implementers).size !== implementers.length) {
      throw new Error("--draft-only routes must select unique implementer model/variant pairs");
    }
  }
  if (isPathInside(fs.realpathSync(cwd), fs.realpathSync(outputDir))) {
    throw new Error(
      "--output-dir must be outside --workdir so the read-only benchmark controller cannot access private OpenCode state",
    );
  }
  const dataHome = preparePrivateDataHome(outputDir);
  const authState = { content: loadOpenCodeAuthContent() };
  absorbAndScrubPersistedAuth(dataHome, authState);
  assertParallelModelAuthSafe({
    authContent: authState.content,
    concurrency: args.concurrency,
    models: selected.map((name) => combinations[name].implementer.model),
  });
  writePrivateFile(path.join(outputDir, `${args.round}-task.md`), `${task}\n`);
  const metadataPath = path.join(outputDir, `${args.round}-metadata.json`);
  const summaryPath = path.join(outputDir, `${args.round}-summary.json`);
  const previousMetadata = fs.existsSync(metadataPath)
    ? JSON.parse(fs.readFileSync(metadataPath, "utf8"))
    : undefined;
  const previousSummaryContents = fs.existsSync(summaryPath)
    ? fs.readFileSync(summaryPath, "utf8")
    : undefined;
  const previousSummarySha256 = previousSummaryContents
    ? createHash("sha256").update(previousSummaryContents).digest("hex")
    : undefined;
  if (
    previousMetadata?.summary_sha256 &&
    previousMetadata.summary_sha256 !== previousSummarySha256
  ) {
    throw new Error("Existing benchmark summary does not match its metadata hash");
  }
  const previousSummary = previousSummaryContents
    ? JSON.parse(previousSummaryContents)
    : undefined;
  const previousRunnerIsLegacy = previousMetadata && (
    previousMetadata.runner_sha256 === undefined ||
    LEGACY_DRAFT_RUNNER_SHA256S.includes(previousMetadata.runner_sha256)
  );
  const legacyOriginMetadata = previousMetadata?.legacy_origin_metadata ?? (
    previousRunnerIsLegacy ? previousMetadata : undefined
  );
  const legacyOriginDrafts = previousMetadata?.legacy_origin_drafts ??
    (previousRunnerIsLegacy ? draftManifest(previousSummary) : []);
  const legacyOriginSummarySha256 =
    previousMetadata?.legacy_origin_summary_sha256 ??
    (previousRunnerIsLegacy ? previousSummarySha256 : undefined);
  const previousRunnerIsCurrent = previousMetadata?.runner_sha256 === RUNNER_SHA256 &&
    previousMetadata.summary_sha256 === previousSummarySha256;
  const frozenOriginMetadata = previousMetadata?.frozen_draft_origin_metadata ??
    (previousRunnerIsCurrent ? previousMetadata : undefined);
  const frozenOriginDrafts = previousMetadata?.frozen_draft_origin_drafts ??
    (previousRunnerIsCurrent ? draftManifest(previousSummary) : []);
  const frozenOriginSummarySha256 =
    previousMetadata?.frozen_draft_origin_summary_sha256 ??
    (previousRunnerIsCurrent ? previousSummarySha256 : undefined);

  const executionOrder = Object.fromEntries(
    Array.from({ length: args.repeat }, (_, index) => {
      const repetition = index + 1;
      return [
        `repetition_${repetition}`,
        deterministicOrder(selected, `${args.seed}:routes:${repetition}`),
      ];
    }),
  );
  const allSelections = new Map();
  for (const selection of selected.flatMap((name) => {
    const combination = combinations[name];
    return [
      combination.implementer,
      ...(args.draft_only || !combination.advisor ? [] : [combination.advisor]),
    ];
  })) {
    const key = `${selection.model}#${selection.variant ?? "default"}`;
    allSelections.set(key, selection);
  }
  const modelRoutes = Object.fromEntries(
    [...allSelections].map(([key, selection]) => {
      const route = modelRouteProvenance(cwd, selection);
      return [key, {
        ...route,
        selected_variant: selection.variant ?? null,
      }];
    }),
  );
  const protocol = args.planning_only
    ? args.draft_only
      ? PLANNING_PROTOCOL
      : PLANNING_REVIEW_PROTOCOL
    : args.draft_only
      ? DIRECT_PROTOCOL
      : PROTOCOL;
  const draftProtocol = args.planning_only ? PLANNING_PROTOCOL : protocol;
  const metadata = {
    round: args.round,
    seed: String(args.seed),
    opencode_launcher: openCodeLauncher,
    workdir: cwd,
    opencode_version: openCodeVersion(),
    runner_sha256: RUNNER_SHA256,
    protocol,
    draft_protocol: draftProtocol,
    planning_only: args.planning_only,
    repeat: args.repeat,
    concurrency: args.concurrency,
    controller_steps: null,
    controller_step_policy:
      "Uncapped so production-shaped analysis and planning are bounded by the request timeout rather than an artificial step ceiling.",
    advisor_steps: args.draft_only || selected.every(
      (name) => combinations[name].review_mode === "self_review",
    ) ? 0 : ADVISOR_STEPS,
    request_timeout_seconds: args.draft_only
      ? DIRECT_REQUEST_TIMEOUT_MS / 1000
      : REQUEST_TIMEOUT_MS / 1000,
    termination_grace_seconds: TERMINATION_GRACE_MS / 1000,
    advisor_system_sha256: createHash("sha256").update(ADVISOR_SYSTEM).digest("hex"),
    cost_semantics: {
      request_cost:
        "Each stage sums completed OpenCode request events. A timed-out or otherwise incomplete request is a lower bound because no terminal usage event may exist.",
      openai_long_context:
        "For OpenAI requests above 272k input plus cache-read plus cache-write tokens, recomputed cost applies 2x to input/cache and 1.5x to output including reasoning.",
      gpt55_cache_write:
        "GPT-5.5 uses documented input, cache-read, and output rates. A request with cache-write usage retains its event-reported cost because the local provider catalog does not expose a defensible cache-write rate.",
      route_total: args.draft_only
        ? "Each direct route total contains one independent controller draft."
        : "Each route total includes its implementer draft, even when that draft is shared with other advisor routes. Treat this as the counterfactual cost of choosing the route; do not sum route totals to estimate experiment spend.",
      experiment_spend:
        "The final metadata records each shared draft once plus each route's advice and revision stages. Reused completed artifacts remain part of the recorded experiment but do not incur new spend in the current invocation.",
    },
    decision_eligibility:
      "Only completed, policy-compliant controller or revised-final artifacts are eligible for routing decisions. Failed, timed-out, incomplete, and policy-violating artifacts may be graded only for diagnosis.",
    advisor_mechanism: args.draft_only
      ? undefined
      : "This benchmark models transcript-fed, tool-less automatic review.",
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
    benchmark_instructions: benchmarkInstructionManifest(cwd),
    fingerprint_schema: {
      draft: 7,
      trial: 3,
      legacy_provider_catalog_fingerprints: "validated_when_reproducible",
    },
    model_routes: modelRoutes,
    model_route_sha256: Object.fromEntries(
      Object.entries(modelRoutes).map(([key, route]) => [key, route.sha256]),
    ),
    legacy_provider_catalog_sha256: Object.fromEntries(
      [...new Set([...allSelections.values()].map(({ model }) => model))]
        .map((model) => [model, modelCatalogHash(cwd, model)]),
    ),
    selected_routes: selected,
    execution_order: executionOrder,
    grading_seed: `${args.seed}:grading:${args.round}`,
    legacy_origin_metadata: legacyOriginMetadata
      ? {
        round: legacyOriginMetadata.round,
        seed: String(legacyOriginMetadata.seed),
        repeat: legacyOriginMetadata.repeat,
        concurrency: legacyOriginMetadata.concurrency ?? null,
        runner_sha256: legacyOriginMetadata.runner_sha256 ?? null,
        protocol: legacyOriginMetadata.protocol,
        draft_protocol: legacyOriginMetadata.draft_protocol,
        selected_routes: legacyOriginMetadata.selected_routes,
        execution_order: legacyOriginMetadata.execution_order,
      }
      : undefined,
    legacy_origin_drafts: legacyOriginDrafts.length > 0
      ? legacyOriginDrafts
      : undefined,
    legacy_origin_summary_sha256: legacyOriginSummarySha256,
    frozen_draft_origin_metadata: frozenOriginMetadata
      ? {
        round: frozenOriginMetadata.round,
        seed: String(frozenOriginMetadata.seed),
        repeat: frozenOriginMetadata.repeat,
        concurrency: frozenOriginMetadata.concurrency ?? null,
        runner_sha256: frozenOriginMetadata.runner_sha256,
        protocol: frozenOriginMetadata.protocol,
        draft_protocol: frozenOriginMetadata.draft_protocol,
        selected_routes: frozenOriginMetadata.selected_routes,
        execution_order: frozenOriginMetadata.execution_order,
      }
      : undefined,
    frozen_draft_origin_drafts: frozenOriginDrafts.length > 0
      ? frozenOriginDrafts
      : undefined,
    frozen_draft_origin_summary_sha256: frozenOriginSummarySha256,
  };
  writePrivateFile(
    metadataPath,
    `${JSON.stringify(metadata, null, 2)}\n`,
  );

  if (args.validate_only) {
    absorbAndScrubPersistedAuth(dataHome, authState);
    console.log(`OK     ${args.round} benchmark inputs and model catalogs validated`);
    return;
  }

  const results = [];
  for (let repetition = 1; repetition <= args.repeat; repetition += 1) {
    const orderedCombinations = executionOrder[`repetition_${repetition}`];
    const repetitionProvenance = benchmarkRepetitionProvenance({
      round: args.round,
      seed: args.seed,
      repetition,
      concurrency: args.concurrency,
      executionOrder: orderedCombinations,
    });
    const drafts = new Map();
    const uniqueImplementers = [];
    for (const combinationName of orderedCombinations) {
      const implementer = combinations[combinationName].implementer;
      const key = implementerKey(implementer);
      if (!uniqueImplementers.some(entry => entry.key === key)) {
        uniqueImplementers.push({ key, implementer });
      }
    }
    for (let index = 0; index < uniqueImplementers.length; index += args.concurrency) {
      const batch = uniqueImplementers.slice(index, index + args.concurrency);
      const completedDrafts = await Promise.all(batch.map(async ({ key, implementer }) => {
        const useIsolatedAuthHome = args.concurrency > 1;
        const draftDataHome = useIsolatedAuthHome
          ? preparePrivateDataHome(path.join(
              outputDir,
              "isolated-draft-auth",
              `repetition-${repetition}`,
              key,
            ))
          : dataHome;
        const draftAuthState = useIsolatedAuthHome
          ? { content: authState.content }
          : authState;
        if (useIsolatedAuthHome) {
          absorbAndScrubPersistedAuth(draftDataHome, draftAuthState);
        }
        const draft = await runDraft({
          cwd,
          task,
          round: args.round,
          outputDir,
          implementer,
          repetition,
          dataHome: draftDataHome,
          authState: draftAuthState,
          protocol: draftProtocol,
          planningOnly: args.planning_only,
          provenance: repetitionProvenance,
          legacyOriginMetadata,
          legacyOriginDrafts,
          frozenOriginMetadata,
          frozenOriginDrafts,
        });
        return { key, draft };
      }));
      for (const { key, draft } of completedDrafts) drafts.set(key, draft);
    }
    if (args.draft_only) {
      for (const combinationName of orderedCombinations) {
        const combination = combinations[combinationName];
        const draft = drafts.get(implementerKey(combination.implementer));
        results.push({
          status: draft.status,
          trial: `${args.round}-${combinationName}-r${repetition}-direct`,
          round: args.round,
          repetition,
          combination: combinationName,
          implementer: combination.implementer,
          eligible_for_decision: decisionEligible(draft.status),
          artifact_provenance: draft.artifact_provenance ?? repetitionProvenance,
          stages: { draft: withoutEvents(draft) },
          totals: {
            ...trialTotals([draft]),
            cost_scope: "direct_controller_route_cost",
          },
        });
      }
      continue;
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
          protocol,
          planningOnly: args.planning_only,
          provenance: {
            ...repetitionProvenance,
            route_position: orderedCombinations.indexOf(combinationName),
          },
          legacyOriginMetadata,
        });
      })));
    }
  }
  const summaryContents = `${JSON.stringify(results, null, 2)}\n`;
  writePrivateFile(summaryPath, summaryContents);
  metadata.summary_sha256 = createHash("sha256")
    .update(summaryContents)
    .digest("hex");
  metadata.summary_result_count = results.length;
  metadata.recorded_experiment_cost = recordedExperimentCosts(results);
  writePrivateFile(
    metadataPath,
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  writeGradingPacket({
    outputDir,
    round: args.round,
    results,
    rubricFile: args.rubric_file,
    seed: metadata.grading_seed,
    planningOnly: args.planning_only,
  });
  absorbAndScrubPersistedAuth(dataHome, authState);
}

if (import.meta.main) {
  await main();
}
