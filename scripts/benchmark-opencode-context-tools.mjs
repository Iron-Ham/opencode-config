#!/usr/bin/env bun

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  assertRawBenchmarkOutputOutsideRepository,
} from "./benchmark-output-containment.mjs";
import {
  assertToolPathsStayInWorkdir,
} from "./benchmark-opencode-model-pairs.mjs";
import {
  benchmarkConfigWithProviders,
  isolatedOpenCodeEnvironment,
  loadOpenCodeAuthContent,
  recomputedRequestCost,
  summarizeEventTiming,
} from "./opencode-benchmark-runtime.mjs";

const repositoryRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const candidateSource = path.join(repositoryRoot, "opencode", "context-tools");
const runtimeSource = path.join(repositoryRoot, "opencode", "context-tools-lib");

function usage() {
  console.error("Usage: benchmark-opencode-context-tools.mjs --task-file PATH --workdir PATH --output-dir PATH --model PROVIDER/MODEL --tool-node-modules PATH [--repeat N] [--timeout-ms N] [--candidate-tools TOOLS] [--require-candidate-tool-use TOOLS]");
}

function parseArguments(argv) {
  const args = {
    repeat: 3,
    timeout_ms: 3_600_000,
    candidate_tools: "glob,grep",
    require_candidate_tool_use: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    const value = argv[index + 1];
    if (!name?.startsWith("--") || value === undefined || value.startsWith("--")) {
      usage();
      throw new Error(`Invalid argument near ${name ?? "end of command"}`);
    }
    args[name.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  args.repeat = Number.parseInt(String(args.repeat), 10);
  args.timeout_ms = Number.parseInt(String(args.timeout_ms), 10);
  if (!Number.isSafeInteger(args.repeat) || args.repeat < 2) {
    throw new Error("--repeat must be an integer of at least 2");
  }
  if (!Number.isSafeInteger(args.timeout_ms) || args.timeout_ms < 1) {
    throw new Error("--timeout-ms must be a positive integer");
  }
  for (const name of ["task_file", "workdir", "output_dir", "model", "tool_node_modules", "validation_command"]) {
    if (typeof args[name] !== "string") throw new Error(`--${name.replaceAll("_", "-")} is required`);
  }
  return args;
}

export function candidateTools(value) {
  const tools = String(value).split(",").map((tool) => tool.trim()).filter(Boolean);
  const allowed = new Set(["glob", "grep", "ast_grep", "text_read"]);
  if (tools.length === 0 || tools.some((tool) => !allowed.has(tool))) {
    throw new Error("--candidate-tools must be a comma-separated subset of glob,grep,ast_grep,text_read");
  }
  return tools;
}

export function requiredCandidateTools(value, candidates) {
  const required = String(value).split(",").map((tool) => tool.trim()).filter(Boolean);
  if (required.some((tool) => !candidates.includes(tool))) {
    throw new Error("--require-candidate-tool-use must be a subset of --candidate-tools");
  }
  return required;
}

export function candidateToolUsage(events, required) {
  const calls = events.filter((event) => event.type === "tool_use")
    .map((event) => event.part?.tool)
    .filter((tool) => typeof tool === "string");
  const counts = Object.fromEntries(
    [...new Set(required)].sort().map((tool) => [tool, calls.filter((call) => call === tool).length]),
  );
  return {
    required,
    counts,
    missing: required.filter((tool) => counts[tool] === 0),
  };
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function writePrivateFile(filePath, content) {
  ensurePrivateDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

function sourceTreeHash(root) {
  const digest = createHash("sha256");
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name))) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        visit(entryPath);
        continue;
      }
      if (!entry.isFile()) continue;
      digest.update(path.relative(root, entryPath));
      digest.update("\0");
      digest.update(fs.readFileSync(entryPath));
      digest.update("\0");
    }
  };
  visit(root);
  return digest.digest("hex");
}

function parseEvents(output) {
  const events = [];
  for (const line of output.split("\n")) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      // OpenCode can append a partial JSON line when a timed-out child exits.
    }
  }
  return events;
}

function extractText(events) {
  return events.filter((event) => event.type === "text")
    .map((event) => event.part?.text ?? event.part?.content ?? "")
    .filter((text) => typeof text === "string")
    .join("\n")
    .trim();
}

function runValidation(command, workdir, answerPath) {
  const result = Bun.spawnSync(["zsh", "-lc", command], {
    cwd: workdir,
    env: { ...process.env, OPENCODE_BENCHMARK_ANSWER_PATH: answerPath },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    passed: result.exitCode === 0,
    exit_code: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`.slice(-4_000),
  };
}

function summarize(events, wallTimeMs, model, startedAtMs) {
  const finishes = events.filter((event) => event.type === "step_finish");
  const tools = events.filter((event) => event.type === "tool_use")
    .map((event) => event.part?.tool)
    .filter(Boolean);
  const sum = (selector) => finishes.reduce((total, event) => total + Number(selector(event) ?? 0), 0);
  return {
    wall_time_seconds: wallTimeMs / 1000,
    timing: summarizeEventTiming(events, startedAtMs),
    tool_calls: tools.length,
    tool_counts: Object.fromEntries([...new Set(tools)].sort().map((tool) => [tool, tools.filter((value) => value === tool).length])),
    recomputed_cost_usd: finishes.reduce((total, event) => total + recomputedRequestCost(event, model), 0),
    tokens: {
      input: sum((event) => event.part?.tokens?.input),
      output: sum((event) => event.part?.tokens?.output),
      reasoning: sum((event) => event.part?.tokens?.reasoning),
      cache_read: sum((event) => event.part?.tokens?.cache?.read),
      cache_write: sum((event) => event.part?.tokens?.cache?.write),
    },
  };
}

function createConfig(workdir) {
  return benchmarkConfigWithProviders(workdir, {
    share: "disabled",
    snapshot: false,
    mcp: {},
    permission: { "*": "deny", read: "allow", glob: "allow", grep: "allow", ast_grep: "allow", text_read: "allow", external_directory: "deny" },
    agent: {
      context_tool_benchmark: {
        mode: "primary",
        permission: { "*": "deny", read: "allow", glob: "allow", grep: "allow", ast_grep: "allow", text_read: "allow", external_directory: "deny" },
      },
    },
  });
}

function configureCandidate(configDirectory, nodeModules, tools) {
  const toolsDirectory = path.join(configDirectory, "tools");
  ensurePrivateDirectory(toolsDirectory);
  for (const name of tools) {
    fs.copyFileSync(path.join(candidateSource, `${name}.ts`), path.join(toolsDirectory, `${name}.ts`));
  }
  fs.cpSync(runtimeSource, path.join(configDirectory, "context-tools-lib"), { recursive: true });
  fs.symlinkSync(nodeModules, path.join(configDirectory, "node_modules"));
}

async function runArm({ arm, repetition, task, workdir, outputDir, model, nodeModules, timeoutMs, authContent, validationCommand, tools, requiredTools }) {
  const stateDirectory = path.join(outputDir, "state", `${String(repetition).padStart(2, "0")}-${arm}`);
  const configHome = path.join(stateDirectory, "xdg-config");
  const configDirectory = path.join(configHome, "opencode");
  const dataHome = path.join(stateDirectory, "xdg-data");
  ensurePrivateDirectory(configDirectory);
  ensurePrivateDirectory(dataHome);
  if (arm === "candidate") configureCandidate(configDirectory, nodeModules, tools);

  const startedAtMs = Date.now();
  const startedAt = performance.now();
  const child = Bun.spawn([
    "opencode", "run", "--pure", "--agent", "context_tool_benchmark", "--dir", workdir,
    "--model", model, "--format", "json", task,
  ], {
    cwd: workdir,
    env: isolatedOpenCodeEnvironment({
      configContent: createConfig(workdir),
      configHome,
      dataHome,
      authContent,
      cwd: workdir,
    }),
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
  }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timer);
  const events = parseEvents(stdout);
  const candidateUsage = arm === "candidate"
    ? candidateToolUsage(events, requiredTools)
    : undefined;
  const answerPath = path.join(outputDir, "answers", `${String(repetition).padStart(2, "0")}-${arm}.md`);
  writePrivateFile(answerPath, `${extractText(events)}\n`);
  const validation = runValidation(validationCommand, workdir, answerPath);
  let policyViolation;
  try {
    assertToolPathsStayInWorkdir(events, workdir);
  } catch (error) {
    policyViolation = error instanceof Error ? error.message : String(error);
  }
  const worktreeStatus = Bun.spawnSync(["git", "status", "--porcelain"], { cwd: workdir }).stdout.toString().trim();
  if (worktreeStatus) {
    policyViolation = `Benchmark changed the worktree: ${worktreeStatus}`;
  }
  writePrivateFile(path.join(outputDir, "raw", `${String(repetition).padStart(2, "0")}-${arm}.jsonl`), stdout);
  writePrivateFile(path.join(outputDir, "raw", `${String(repetition).padStart(2, "0")}-${arm}.stderr`), stderr);
  return {
    arm,
    repetition,
    status: policyViolation ? "policy_violation" : timedOut ? "timeout" : exitCode !== 0 ? "failed" : !validation.passed ? "validation_failed" : candidateUsage?.missing.length ? "candidate_unused" : "completed",
    exit_code: exitCode,
    policy_violation: policyViolation,
    validation: { passed: validation.passed, exit_code: validation.exit_code },
    candidate_tool_usage: candidateUsage,
    raw_event_sha256: createHash("sha256").update(stdout).digest("hex"),
    metrics: summarize(events, performance.now() - startedAt, model, startedAtMs),
  };
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  const tools = candidateTools(args.candidate_tools);
  const requiredTools = requiredCandidateTools(args.require_candidate_tool_use, tools);
  const outputDir = assertRawBenchmarkOutputOutsideRepository(args.output_dir);
  const workdir = fs.realpathSync(args.workdir);
  const taskFile = fs.realpathSync(args.task_file);
  const nodeModules = fs.realpathSync(args.tool_node_modules);
  if (!fs.statSync(workdir).isDirectory()) throw new Error("--workdir must be a directory");
  if (!fs.statSync(taskFile).isFile()) throw new Error("--task-file must be a regular file");
  if (!fs.statSync(nodeModules).isDirectory()) throw new Error("--tool-node-modules must be a directory");
  if (isPathInside(workdir, outputDir)) {
    throw new Error("--output-dir must be outside the benchmark worktree");
  }
  if (fs.existsSync(path.join(workdir, ".git")) && Bun.spawnSync(["git", "status", "--porcelain"], { cwd: workdir }).stdout.toString().trim()) {
    throw new Error("Benchmark worktree must be clean");
  }
  ensurePrivateDirectory(outputDir);
  const task = fs.readFileSync(taskFile, "utf8");
  const authContent = loadOpenCodeAuthContent();
  const trials = [];
  for (let repetition = 1; repetition <= args.repeat; repetition += 1) {
    const arms = repetition % 2 === 0 ? ["candidate", "baseline"] : ["baseline", "candidate"];
    for (const arm of arms) {
      trials.push(await runArm({ arm, repetition, task, workdir, outputDir, model: args.model, nodeModules, timeoutMs: args.timeout_ms, authContent, validationCommand: args.validation_command, tools, requiredTools }));
    }
  }
  writePrivateFile(path.join(outputDir, "summary.json"), `${JSON.stringify({
    schema_version: 1,
    protocol: "paired-native-versus-context-tool-overrides-v1",
    privacy: "raw task, events, stderr, and state remain only in this private output directory",
    task_sha256: createHash("sha256").update(task).digest("hex"),
    candidate_tools: tools,
    required_candidate_tool_use: requiredTools,
    candidate_tool_source_sha256: Object.fromEntries(tools.map((tool) => [
      tool,
      createHash("sha256").update(fs.readFileSync(path.join(candidateSource, `${tool}.ts`))).digest("hex"),
    ])),
    candidate_runtime_source_sha256: sourceTreeHash(runtimeSource),
    trials,
  }, null, 2)}\n`);
  console.log(`Private benchmark results written to ${outputDir}`);
}

if (import.meta.main) {
  await main();
}
