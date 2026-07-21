#!/usr/bin/env bun

import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  assertRawBenchmarkOutputOutsideRepository,
} from "./benchmark-output-containment.mjs";
import {
  aggregateEventTiming,
  benchmarkConfigWithProviders,
  benchmarkInstructionManifest,
  isolatedOpenCodeEnvironment,
  loadOpenCodeAuthContent,
  recomputedRequestCost,
  resolveBenchmarkModelRoute,
  summarizeEventTiming,
} from "./opencode-benchmark-runtime.mjs";

process.umask(0o077);

const candidates = {
  sonnet: {
    model: "anthropic/claude-sonnet-5",
    effort: "default",
  },
  "gpt-5.5-xhigh": {
    model: "openai/gpt-5.5",
    variant: "xhigh",
    effort: "xhigh",
  },
  "luna-high": {
    model: "openai/gpt-5.6-luna",
    variant: "high",
    effort: "high",
  },
  luna: {
    model: "openai/gpt-5.6-luna",
    variant: "xhigh",
    effort: "xhigh",
  },
  terra: {
    model: "openai/gpt-5.6-terra",
    variant: "xhigh",
    effort: "xhigh",
  },
  "terra-max": {
    model: "openai/gpt-5.6-terra",
    variant: "max",
    effort: "max",
  },
  "sol-high": {
    model: "openai/gpt-5.6-sol",
    variant: "high",
    effort: "high",
  },
  "glm-baseten": {
    model: "baseten/zai-org/GLM-5.2",
    variant: "max",
    effort: "max",
  },
  "glm-fireworks": {
    model: "fireworks-ai/accounts/fireworks/models/glm-5p2",
    variant: "max",
    effort: "max",
  },
  "glm-fireworks-fast": {
    model: "fireworks-ai/accounts/fireworks/routers/glm-5p2-fast",
    variant: "max",
    effort: "max",
  },
  "kimi-baseten": {
    model: "baseten/moonshotai/Kimi-K2.7-Code",
    effort: "default",
  },
  "kimi-fireworks": {
    model: "fireworks-ai/accounts/fireworks/models/kimi-k2p7-code",
    effort: "default",
  },
  "kimi-fireworks-fast": {
    model: "fireworks-ai/accounts/fireworks/routers/kimi-k2p7-code-fast",
    effort: "default",
  },
};
const DEFAULT_CANDIDATES = ["sonnet", "luna", "terra"];
const IMPLEMENTER_TIMEOUT_MS = benchmarkTimeout(
  "OPENCODE_BENCHMARK_IMPLEMENTER_TIMEOUT_MS",
  60 * 60 * 1000,
);

function benchmarkTimeout(environmentVariable, fallback) {
  const value = Number(process.env[environmentVariable] ?? fallback);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${environmentVariable} must be a positive number of milliseconds`);
  }
  return value;
}

let openCodeLauncher = "direct";

function openCodeCommand(args) {
  return openCodeLauncher === "notion-local"
    ? ["notion", "local", "opencode", ...args]
    : ["opencode", ...args];
}

const ADVISOR_SYSTEM =
  "You are a senior Swift correctness advisor to a coding agent. " +
  "Review the frozen implementation against only the supplied public contract and evidence. " +
  "Identify material correctness, concurrency, state-machine, and test-coverage risks. " +
  "Give concise, concrete repair guidance; do not write the full implementation. " +
  "If no material change is justified, say so explicitly. Keep the response under 300 words.";
const ADVISOR_STEPS = 4;
const DEFAULT_BENCHMARK_SPEC = {
  schema_version: 1,
  benchmark_id: "reliable-pager",
  source_path: path.join("Sources", "ReliablePager", "FeedPager.swift"),
  hidden_test_destination: path.join(
    "Tests",
    "ReliablePagerTests",
    "HiddenFeedPagerTests.swift",
  ),
  banned_source_patterns: [
    "@unchecked Sendable",
    "nonisolated(unsafe)",
    "Task.detached",
    "Task.sleep",
    "Thread.sleep",
    "usleep",
    "DispatchSemaphore",
    "#if compiler",
  ],
  test_weights: {
    sequentialPaginationStopsAtEnd: 4,
    failureRetriesCommittedCursor: 4,
    concurrentLoadsShareRequest: 8,
    resetCancelsAndRejectsLateResponse: 10,
    deduplicatesWithinAndAcrossPages: 7,
    thirtyTwoConcurrentCallersCommitExactlyOnce: 9,
    coalescedFailureIsSharedAndRetryable: 7,
    resetThenReloadProtectsTheNewGeneration: 12,
    staleFailureAfterResetDoesNotClearFreshLoad: 12,
    emptyPageAdvancesCursorAndFailureDoesNot: 7,
  },
  public_tests: [
    "sequentialPaginationStopsAtEnd",
    "failureRetriesCommittedCursor",
    "concurrentLoadsShareRequest",
    "resetCancelsAndRejectsLateResponse",
    "deduplicatesWithinAndAcrossPages",
  ],
  critical_tests: [
    "concurrentLoadsShareRequest",
    "resetThenReloadProtectsTheNewGeneration",
    "staleFailureAfterResetDoesNotClearFreshLoad",
  ],
  expected_baseline_results: {
    sequentialPaginationStopsAtEnd: true,
    failureRetriesCommittedCursor: true,
    concurrentLoadsShareRequest: false,
    resetCancelsAndRejectsLateResponse: false,
    deduplicatesWithinAndAcrossPages: false,
  },
  expected_baseline_exit: "nonzero",
  expected_baseline_build: true,
  quality_floor_score: 85,
  critical_failure_score_cap: 69,
  review_context_paths: ["AGENTS.md", "README.md"],
  task_prompt:
    "Fix the ReliablePager Swift Package so it satisfies its documented behavior.",
};

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
  return dataHome;
}

function preparePrivateConfigHome(outputDir) {
  const configHome = path.join(outputDir, "xdg-config");
  const openCodeConfig = path.join(configHome, "opencode");
  ensurePrivateDirectory(openCodeConfig);
  return configHome;
}

function absorbAndScrubPersistedAuth(dataHome, authState) {
  const authPath = path.join(dataHome, "opencode", "auth.json");
  const entry = fs.lstatSync(authPath, { throwIfNoEntry: false });
  if (!entry) return;
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

function sanitizedTestEnvironment(runtimeDirectory) {
  const home = path.join(runtimeDirectory, "home");
  const temporaryDirectory = path.join(runtimeDirectory, "tmp");
  ensurePrivateDirectory(home);
  ensurePrivateDirectory(temporaryDirectory);
  const allowed = [
    "PATH",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "DEVELOPER_DIR",
    "SDKROOT",
    "TOOLCHAINS",
    "SWIFT_EXEC",
  ];
  return {
    ...Object.fromEntries(
      allowed.flatMap((name) => process.env[name] === undefined
        ? []
        : [[name, process.env[name]]]),
    ),
    HOME: home,
    TMPDIR: temporaryDirectory,
    TMP: temporaryDirectory,
    TEMP: temporaryDirectory,
  };
}

function parseArguments(argv) {
  const args = { repeat: 3, seed: "ios-swift-implementer-v1" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(`Invalid argument near ${flag}`);
    }
    args[flag.slice(2).replaceAll("-", "_")] = value;
    index += 1;
  }
  args.repeat = Number.parseInt(String(args.repeat), 10);
  return args;
}

function isEnabled(value) {
  return value === true || value === "true" || value === "1" || value === "yes";
}

function normalizeRelativePath(value, field) {
  if (typeof value !== "string" || value.length === 0 || path.isAbsolute(value)) {
    throw new Error(`${field} must be a non-empty relative path`);
  }
  const normalized = path.normalize(value);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error(`${field} must stay inside the fixture workspace`);
  }
  return normalized;
}

function isPathInside(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" ||
    (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function validateStringArray(value, field, { allowEmpty = false } = {}) {
  if (
    !Array.isArray(value) ||
    (!allowEmpty && value.length === 0) ||
    value.some((item) => typeof item !== "string" || item.length === 0)
  ) {
    throw new Error(`${field} must be ${allowEmpty ? "an" : "a non-empty"} array of strings`);
  }
  return [...value];
}

function loadBenchmarkSpec(args) {
  let manifest = {};
  let manifestPath;
  if (args.manifest_file) {
    manifestPath = path.resolve(args.manifest_file);
    const manifestEntry = fs.lstatSync(manifestPath, { throwIfNoEntry: false });
    if (!manifestEntry?.isFile() || manifestEntry.isSymbolicLink()) {
      throw new Error("Benchmark manifest must be a real file, not a symbolic link");
    }
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (manifest.schema_version !== 1) {
      throw new Error("Benchmark manifest schema_version must be 1");
    }
  }
  const spec = manifestPath
    ? {
        expected_baseline_exit: "nonzero",
        expected_baseline_build: true,
        quality_floor_score: 85,
        critical_failure_score_cap: 69,
        critical_tests: [],
        banned_source_patterns: [],
        review_context_paths: [],
        ...manifest,
      }
    : { ...DEFAULT_BENCHMARK_SPEC };
  const manifestDirectory = manifestPath
    ? path.dirname(manifestPath)
    : process.cwd();
  const fixtureInput = args.fixture_dir ?? spec.fixture_dir;
  const hiddenTestInput = args.hidden_test_file ?? spec.hidden_test_file;
  if (!fixtureInput) {
    throw new Error("Missing --fixture-dir or manifest fixture_dir");
  }
  if (!hiddenTestInput) {
    throw new Error("Missing --hidden-test-file or manifest hidden_test_file");
  }
  const resolveInputPath = (value, fromManifest) => path.resolve(
    fromManifest ? manifestDirectory : process.cwd(),
    value,
  );
  const fixtureDir = resolveInputPath(
    fixtureInput,
    args.fixture_dir === undefined && spec.fixture_dir !== undefined,
  );
  const hiddenTest = resolveInputPath(
    hiddenTestInput,
    args.hidden_test_file === undefined && spec.hidden_test_file !== undefined,
  );
  if (!fs.statSync(fixtureDir, { throwIfNoEntry: false })?.isDirectory()) {
    throw new Error(`Fixture directory does not exist: ${fixtureDir}`);
  }
  if (!fs.statSync(hiddenTest, { throwIfNoEntry: false })?.isFile()) {
    throw new Error(`Hidden test file does not exist: ${hiddenTest}`);
  }
  if (manifestPath && isPathInside(fixtureDir, manifestPath)) {
    throw new Error("Benchmark manifest must live outside the model-visible fixture");
  }
  if (isPathInside(fixtureDir, hiddenTest)) {
    throw new Error("Hidden test file must live outside the model-visible fixture");
  }
  assertSafeInputTree(fixtureDir, "Fixture");
  if (fs.lstatSync(hiddenTest).isSymbolicLink()) {
    throw new Error("Hidden test file must not be a symbolic link");
  }
  spec.source_path = normalizeRelativePath(spec.source_path, "source_path");
  spec.hidden_test_destination = normalizeRelativePath(
    spec.hidden_test_destination,
    "hidden_test_destination",
  );
  if (spec.source_path === spec.hidden_test_destination) {
    throw new Error("source_path and hidden_test_destination must differ");
  }
  if (!fs.statSync(path.join(fixtureDir, spec.source_path), {
    throwIfNoEntry: false,
  })?.isFile()) {
    throw new Error(`Fixture source_path does not exist: ${spec.source_path}`);
  }
  if (fs.existsSync(path.join(fixtureDir, spec.hidden_test_destination))) {
    throw new Error("The hidden test destination must not exist in the public fixture");
  }
  spec.public_tests = validateStringArray(spec.public_tests, "public_tests");
  spec.critical_tests = validateStringArray(spec.critical_tests, "critical_tests", {
    allowEmpty: true,
  });
  spec.banned_source_patterns = validateStringArray(
    spec.banned_source_patterns ?? [],
    "banned_source_patterns",
    { allowEmpty: true },
  );
  spec.review_context_paths = validateStringArray(
    spec.review_context_paths ?? [],
    "review_context_paths",
    { allowEmpty: true },
  ).map((value) => normalizeRelativePath(value, "review_context_paths[]"));
  if (
    !spec.test_weights ||
    typeof spec.test_weights !== "object" ||
    Array.isArray(spec.test_weights) ||
    Object.keys(spec.test_weights).length === 0 ||
    Object.values(spec.test_weights).some(
      (weight) => !Number.isFinite(weight) || weight <= 0,
    )
  ) {
    throw new Error("test_weights must map test names to positive numeric weights");
  }
  const totalTestWeight = Object.values(spec.test_weights).reduce(
    (total, weight) => total + weight,
    0,
  );
  if (totalTestWeight !== 80) {
    throw new Error("test_weights must sum to 80; build and compliance supply 10 points each");
  }
  if (spec.public_tests.some((name) => !(name in spec.test_weights))) {
    throw new Error("Every public test must have an entry in test_weights");
  }
  if (spec.critical_tests.some((name) => !(name in spec.test_weights))) {
    throw new Error("Every critical test must have an entry in test_weights");
  }
  if (
    !spec.expected_baseline_results ||
    typeof spec.expected_baseline_results !== "object" ||
    Array.isArray(spec.expected_baseline_results) ||
    Object.entries(spec.expected_baseline_results).some(
      ([name, expected]) => !(name in spec.test_weights) || typeof expected !== "boolean",
    )
  ) {
    throw new Error(
      "expected_baseline_results must map weighted test names to booleans",
    );
  }
  if (!["zero", "nonzero", "any"].includes(spec.expected_baseline_exit)) {
    throw new Error("expected_baseline_exit must be zero, nonzero, or any");
  }
  if (typeof spec.expected_baseline_build !== "boolean") {
    throw new Error("expected_baseline_build must be boolean");
  }
  if (
    !Number.isFinite(spec.quality_floor_score) ||
    spec.quality_floor_score < 0 ||
    spec.quality_floor_score > 100 ||
    !Number.isFinite(spec.critical_failure_score_cap) ||
    spec.critical_failure_score_cap < 0 ||
    spec.critical_failure_score_cap > 100
  ) {
    throw new Error("quality score thresholds must be numbers from 0 through 100");
  }
  if (typeof spec.task_prompt !== "string" || spec.task_prompt.trim().length === 0) {
    throw new Error("task_prompt must be a non-empty string");
  }
  if (typeof spec.benchmark_id !== "string" || spec.benchmark_id.length === 0) {
    throw new Error("benchmark_id must be a non-empty string");
  }
  return {
    spec,
    fixtureDir,
    hiddenTest,
    manifestPath,
    manifestHash: manifestPath
      ? createHash("sha256").update(fs.readFileSync(manifestPath)).digest("hex")
      : null,
  };
}

function advisorConfiguration(args) {
  const disabled = new Set(["none", "off", "disabled"]);
  if (!args.advisor_model || disabled.has(String(args.advisor_model).toLowerCase())) {
    return null;
  }
  return {
    model: String(args.advisor_model),
    effort: args.advisor_variant ? String(args.advisor_variant) : "default",
    ...(args.advisor_variant ? { variant: String(args.advisor_variant) } : {}),
  };
}

function deterministicBaseOrder(values, seed) {
  return [...values].sort((left, right) => {
    const leftHash = createHash("sha256").update(`${seed}:${left}`).digest("hex");
    const rightHash = createHash("sha256").update(`${seed}:${right}`).digest("hex");
    return leftHash.localeCompare(rightHash) || left.localeCompare(right);
  });
}

function latinSquareOrder(values, seed, repetition) {
  const base = deterministicBaseOrder(values, seed);
  const cycle = Math.floor((repetition - 1) / base.length);
  const cycleBase = cycle % 2 === 0 ? base : [...base].reverse();
  const offset = (repetition - 1) % cycleBase.length;
  return [...cycleBase.slice(offset), ...cycleBase.slice(0, offset)];
}

function hashTree(directory, excludedNames = new Set()) {
  const hash = createHash("sha256");
  function visit(current, relative = "") {
    const entries = fs.readdirSync(current, { withFileTypes: true })
      .filter((entry) => !excludedNames.has(entry.name))
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const entryRelative = path.join(relative, entry.name);
      const absolute = path.join(current, entry.name);
      hash.update(entryRelative);
      if (entry.isDirectory()) {
        visit(absolute, entryRelative);
      } else if (entry.isFile()) {
        hash.update(fs.readFileSync(absolute));
      }
    }
  }
  visit(directory);
  return hash.digest("hex");
}

function assertSafeInputTree(root, label) {
  function visit(current) {
    const entry = fs.lstatSync(current);
    if (entry.isSymbolicLink()) {
      throw new Error(`${label} must not contain symbolic links: ${current}`);
    }
    if (entry.isDirectory()) {
      for (const child of fs.readdirSync(current)) {
        if (child === "benchmark.json") {
          throw new Error(
            `${label} must not contain model-visible benchmark metadata: ${path.join(current, child)}`,
          );
        }
        if (child !== ".build") visit(path.join(current, child));
      }
      return;
    }
    if (!entry.isFile()) {
      throw new Error(`${label} contains an unsupported filesystem entry: ${current}`);
    }
  }
  visit(root);
}

function benchmarkConfig(cwd) {
  return benchmarkConfigWithProviders(cwd, {
    snapshot: false,
    share: "disabled",
    mcp: {},
    agent: {
      swift_implementer: {
        mode: "primary",
        steps: 50,
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
          edit: "allow",
          bash: "deny",
          external_directory: "deny",
        },
      },
      swift_advisor: {
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
      task: "deny",
      todowrite: "deny",
    },
  });
}

function benchmarkConfigFingerprint(cwd) {
  const config = JSON.parse(benchmarkConfig(cwd));
  config.instructions = benchmarkInstructionManifest(cwd).map((instruction) => ({
    relative_path: path.relative(cwd, instruction.path),
    sha256: instruction.sha256,
  }));
  return config;
}

function parseEvents(output) {
  const events = [];
  const lines = output.split("\n");
  for (const [index, line] of lines.entries()) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      if (index === lines.length - 1 && !output.endsWith("\n")) continue;
      throw new Error(`Malformed OpenCode event at line ${index + 1}`, { cause: error });
    }
  }
  return events;
}

function extractText(events) {
  const messageID = events.findLast(
    (event) => event.type === "step_finish" && event.part?.reason === "stop",
  )?.part?.messageID;
  return events
    .filter((event) => event.type === "text" && event.part?.messageID === messageID)
    .map((event) => event.part?.text ?? "")
    .join("")
    .trim();
}

function assertToolPathsStayInWorkspace(events, cwd) {
  const workspaceRoot = path.resolve(cwd);
  const workspace = `${workspaceRoot}${path.sep}`;
  const pathKeys = new Set([
    "directory",
    "filePath",
    "file_path",
    "filepath",
    "path",
    "workdir",
  ]);
  const resolveToolPath = (value) => {
    if (value === "~") return os.homedir();
    if (value.startsWith(`~${path.sep}`)) {
      return path.resolve(os.homedir(), value.slice(2));
    }
    return path.resolve(cwd, value);
  };
  const assertPath = (value) => {
    const resolved = resolveToolPath(value);
    if (resolved !== workspaceRoot && !`${resolved}${path.sep}`.startsWith(workspace)) {
      throw new Error(
        `Model tool attempted to access a path outside its trial workspace: ${value}`,
      );
    }
  };
  for (const event of events) {
    if (event.type !== "tool_use") continue;
    const input = event.part?.state?.input;
    if (!input || typeof input !== "object") continue;
    for (const [key, value] of Object.entries(input)) {
      const isGlobPattern = event.part?.tool === "glob" && key === "pattern";
      if (
        (!pathKeys.has(key) && !isGlobPattern) ||
        typeof value !== "string"
      ) {
        continue;
      }
      assertPath(value);
    }
    if (event.part?.tool === "apply_patch" && typeof input.patchText === "string") {
      for (const line of input.patchText.split("\n")) {
        const header = line.match(
          /^\*\*\* (?:Add File|Update File|Delete File|Move to): (.+)\s*$/,
        );
        if (header) assertPath(header[1].trim());
      }
    }
  }
}

function validateToolPathGuard(cwd) {
  const event = (tool, input) => [{
    type: "tool_use",
    part: { tool, state: { input } },
  }];
  assertToolPathsStayInWorkspace(
    event("read", { filePath: "Sources/Package/File.swift" }),
    cwd,
  );
  assertToolPathsStayInWorkspace(
    event("glob", { pattern: "Sources/**/*.swift" }),
    cwd,
  );
  assertToolPathsStayInWorkspace(event("apply_patch", {
    patchText:
      "*** Begin Patch\n*** Update File: Sources/Package/File.swift\n*** Move to: Sources/Package/Renamed.swift\n*** End Patch",
  }), cwd);
  for (const [tool, input] of [
    ["read", { filePath: "../hidden-tests.txt" }],
    ["read", { file_path: "~/.config/opencode/AGENTS.md" }],
    ["grep", { path: path.join(os.homedir(), "secret") }],
    ["glob", { pattern: "../**/*" }],
    ["apply_patch", {
      patchText: "*** Begin Patch\n*** Add File: ../leaked.swift\n*** End Patch",
    }],
    ["apply_patch", {
      patchText: "*** Begin Patch\n*** Update File: ~/.config/opencode/AGENTS.md\n*** End Patch",
    }],
    ["apply_patch", {
      patchText: `*** Begin Patch\n*** Delete File: ${path.join(os.homedir(), "secret")}\n*** End Patch`,
    }],
    ["apply_patch", {
      patchText: "*** Begin Patch\n*** Update File: Sources/Package/File.swift\n*** Move to: ../../moved.swift\n*** End Patch",
    }],
  ]) {
    let rejected = false;
    try {
      assertToolPathsStayInWorkspace(event(tool, input), cwd);
    } catch {
      rejected = true;
    }
    if (!rejected) {
      throw new Error(`Tool-path guard accepted an out-of-workspace ${tool} input`);
    }
  }
}

function summarize(
  events,
  wallTimeMs,
  model,
  invocationStartedAtMs,
  timingOverride,
) {
  const finishes = events.filter((event) => event.type === "step_finish");
  const tools = events.filter((event) => event.type === "tool_use");
  const sum = (selector) => finishes.reduce(
    (total, event) => total + Number(selector(event) ?? 0),
    0,
  );
  return {
    wall_time_seconds: wallTimeMs / 1000,
    timing: timingOverride ?? summarizeEventTiming(events, invocationStartedAtMs),
    requests: finishes.length,
    tool_calls: tools.length,
    tool_counts: Object.fromEntries(
      [...new Set(tools.map((event) => event.part?.tool).filter(Boolean))]
        .sort()
        .map((tool) => [
          tool,
          tools.filter((event) => event.part?.tool === tool).length,
        ]),
    ),
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

async function runWithTimeout(command, options, timeoutMs) {
  const child = Bun.spawn(command, {
    ...options,
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  let forceKill;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill("SIGTERM");
    forceKill = setTimeout(() => child.kill("SIGKILL"), 5000);
  }, timeoutMs);
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  clearTimeout(timeout);
  clearTimeout(forceKill);
  return { stdout, stderr, exitCode, timedOut };
}

async function runOpenCodeTurn({
  cwd,
  model,
  variant,
  agent = "swift_implementer",
  title,
  dataHome,
  configHome,
  authState,
  prompt,
  session,
}) {
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
  ];
  if (session) {
    args.push("--session", session);
  } else {
    args.push("--title", title);
  }
  if (variant) args.push("--variant", variant);
  args.push(prompt);
  const startedAtEpochMs = Date.now();
  const started = performance.now();
  const execution = await runWithTimeout(
    openCodeCommand(args),
    {
      cwd,
      env: isolatedOpenCodeEnvironment({
        configContent: benchmarkConfig(cwd),
        configHome,
        dataHome,
        authContent: authState.content,
        cwd,
      }),
    },
    IMPLEMENTER_TIMEOUT_MS,
  );
  absorbAndScrubPersistedAuth(dataHome, authState);
  const events = parseEvents(execution.stdout);
  assertToolPathsStayInWorkspace(events, cwd);
  const completed = events.some(
    (event) => event.type === "step_finish" && event.part?.reason === "stop",
  );
  const status = execution.timedOut
    ? "timeout"
    : execution.exitCode !== 0
      ? "failed"
      : completed
        ? "completed"
        : "incomplete";
  const metrics = summarize(
    events,
    performance.now() - started,
    model,
    startedAtEpochMs,
  );
  metrics.cost_completeness = status === "completed"
    ? "complete_for_observed_requests"
    : "unknown_total_lower_bound";
  return {
    status,
    exit_code: execution.exitCode,
    session_id: events.find((event) => event.sessionID)?.sessionID,
    text: extractText(events),
    error: execution.exitCode === 0
      ? undefined
      : (execution.stderr || execution.stdout.slice(-2000)),
    invocation_started_at_ms: startedAtEpochMs,
    metrics,
    events,
  };
}

export function summarizeSwiftPhaseTiming(turns) {
  return aggregateEventTiming(turns.map((turn) => ({
    events: turn.events,
    invocationStartedAtMs: turn.invocation_started_at_ms,
  })));
}

async function runImplementation({
  cwd,
  spec,
  model,
  variant,
  title,
  dataHome,
  configHome,
  authState,
}) {
  const turns = [];
  const testAttempts = [];
  let session;
  let prompt = `${spec.task_prompt.trim()}\n\nRead the public instructions and contract before editing. Work only in ${spec.source_path}, preserve the public API, and use Swift 6-safe concurrency. Do not add dependencies or weaken tests. The benchmark harness—not your shell—will run the public Swift Package tests after each turn and return failures for revision. Do not call an advisor or delegate.\n\nInspect and edit the implementation, then report that it is ready for the fixed test harness.`;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const turn = await runOpenCodeTurn({
      cwd,
      model,
      variant,
      title: `${title}-turn-${attempt}`,
      dataHome,
      configHome,
      authState,
      prompt,
      session,
    });
    turns.push(turn);
    if (turn.session_id) session = turn.session_id;
    const tests = await runSwiftTests(cwd);
    testAttempts.push(tests);
    const results = testResults(tests.output, spec);
    if (tests.exit_code === 0 && spec.public_tests.every((name) => results[name])) {
      break;
    }
    if (turn.status !== "completed" || !session) break;
    const testTail = tests.output.slice(-12000);
    prompt = `The fixed benchmark harness ran the public Swift Package tests; the suite still failed. Reconcile the diagnostics below with the documented contract, edit only the permitted implementation file, and report when the next fixed test run is ready.\n\nTEST OUTPUT\n${testTail}`;
  }

  const events = turns.flatMap((turn) => turn.events);
  const modelWallMs = turns.reduce(
    (total, turn) => total + turn.metrics.wall_time_seconds * 1000,
    0,
  );
  const last = turns.at(-1);
  const timing = summarizeSwiftPhaseTiming(turns);
  const metrics = summarize(events, modelWallMs, model, undefined, timing);
  metrics.cost_completeness = turns.every(
    (turn) => turn.metrics.cost_completeness === "complete_for_observed_requests",
  )
    ? "complete_for_observed_requests"
    : "unknown_total_lower_bound";
  return {
    status: last?.status ?? "failed",
    exit_code: last?.exit_code ?? 1,
    session_id: session,
    text: last?.text ?? "",
    error: last?.error,
    turns: turns.map(({ events: _events, ...turn }) => turn),
    metrics,
    events,
    test_attempts: testAttempts,
  };
}

function withoutEvents(stage) {
  const { events, ...summary } = stage;
  return summary;
}

function combinedMetrics(stages, scope) {
  const active = stages.filter(Boolean);
  const tokenKeys = [
    "traffic",
    "input",
    "output",
    "reasoning",
    "cache_read",
    "cache_write",
  ];
  const sum = (selector) => active.reduce(
    (total, stage) => total + Number(selector(stage) ?? 0),
    0,
  );
  return {
    cost_scope: scope,
    cost_completeness: active.every(
      (stage) => stage.metrics.cost_completeness === "complete_for_observed_requests",
    )
      ? "complete_for_observed_requests"
      : "unknown_total_lower_bound",
    wall_time_seconds: sum((stage) => stage.metrics.wall_time_seconds),
    requests: sum((stage) => stage.metrics.requests),
    tool_calls: sum((stage) => stage.metrics.tool_calls),
    reported_cost_usd: sum((stage) => stage.metrics.reported_cost_usd),
    recomputed_cost_usd: sum((stage) => stage.metrics.recomputed_cost_usd),
    tokens: Object.fromEntries(tokenKeys.map((key) => [
      key,
      sum((stage) => stage.metrics.tokens[key]),
    ])),
  };
}

function publicTestSummary(tests, spec) {
  return {
    exit_code: tests.exit_code,
    timed_out: tests.timed_out,
    wall_time_seconds: tests.wall_time_seconds,
    results: testResults(tests.output, spec),
  };
}

function validateBaselineResult(baseline, spec, label) {
  const results = testResults(baseline.output, spec);
  const exitMatches = spec.expected_baseline_exit === "any" ||
    (spec.expected_baseline_exit === "zero" && baseline.exit_code === 0) ||
    (spec.expected_baseline_exit === "nonzero" && baseline.exit_code !== 0);
  const buildMatches = /Build complete!/.test(baseline.output) ===
    spec.expected_baseline_build;
  const outcomesMatch = Object.entries(spec.expected_baseline_results).every(
    ([test, expected]) => results[test] === expected,
  );
  if (baseline.timed_out || !exitMatches || !buildMatches || !outcomesMatch) {
    throw new Error(`Fixture baseline contract changed for ${label}`);
  }
  return results;
}

function writeStageArtifacts(trialDir, name, stage) {
  writePrivateFile(
    path.join(trialDir, `${name}-events.jsonl`),
    `${stage.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  writePrivateFile(path.join(trialDir, `${name}-answer.md`), `${stage.text}\n`);
}

function binaryPatch(workspace) {
  return command(["git", "diff", "--binary", "HEAD"], workspace);
}

function copyUntrackedFiles(sourceWorkspace, destinationWorkspace) {
  const result = Bun.spawnSync(
    ["git", "ls-files", "--others", "--exclude-standard", "-z"],
    { cwd: sourceWorkspace, stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    throw new Error(`Cannot list untracked benchmark files: ${result.stderr.toString()}`);
  }
  for (const relativePath of result.stdout.toString().split("\0").filter(Boolean)) {
    const safePath = normalizeRelativePath(relativePath, "untracked workspace path");
    const source = path.join(sourceWorkspace, safePath);
    const destination = path.join(destinationWorkspace, safePath);
    const stat = fs.lstatSync(source);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Unsupported untracked benchmark entry: ${safePath}`);
    }
    ensurePrivateDirectory(path.dirname(destination));
    fs.copyFileSync(source, destination);
    fs.chmodSync(destination, 0o600);
  }
}

function prepareEvaluationWorkspace({
  fixtureDir,
  implementationWorkspace,
  evaluationWorkspace,
  patchPath,
}) {
  prepareWorkspace(fixtureDir, evaluationWorkspace);
  const patchContents = binaryPatch(implementationWorkspace);
  writePrivateFile(patchPath, patchContents);
  if (patchContents.length > 0) {
    command(["git", "apply", "--binary", patchPath], evaluationWorkspace);
  }
  copyUntrackedFiles(implementationWorkspace, evaluationWorkspace);
  return command(["git", "ls-files"], evaluationWorkspace)
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
}

async function evaluateFrozenWorkspace({
  fixtureDir,
  hiddenTest,
  implementationWorkspace,
  trialDir,
  artifactName,
  spec,
  publicTests,
  stageStatus,
}) {
  const evaluationWorkspace = path.join(
    trialDir,
    `${artifactName}-evaluation`,
    "workspace",
  );
  const patchPath = path.join(trialDir, `${artifactName}.patch.diff`);
  const baselineFiles = prepareEvaluationWorkspace({
    fixtureDir,
    implementationWorkspace,
    evaluationWorkspace,
    patchPath,
  });
  const hiddenDestination = path.join(
    evaluationWorkspace,
    spec.hidden_test_destination,
  );
  ensurePrivateDirectory(path.dirname(hiddenDestination));
  fs.copyFileSync(hiddenTest, hiddenDestination);
  fs.chmodSync(hiddenDestination, 0o600);
  const hiddenTests = await runSwiftTests(evaluationWorkspace);
  fs.rmSync(hiddenDestination, { force: true });
  writePrivateFile(
    path.join(trialDir, `${artifactName}-hidden-tests.txt`),
    hiddenTests.output,
  );
  const evaluation = grade({
    workspace: evaluationWorkspace,
    spec,
    testOutput: hiddenTests.output,
    baselineFiles,
    publicTests,
    hiddenTests,
    stageStatus,
  });
  return {
    patch_sha256: createHash("sha256").update(
      fs.readFileSync(patchPath),
    ).digest("hex"),
    hidden_tests: {
      exit_code: hiddenTests.exit_code,
      timed_out: hiddenTests.timed_out,
      wall_time_seconds: hiddenTests.wall_time_seconds,
    },
    evaluation,
  };
}

function advisorReviewPrompt({ workspace, spec, directPatch, publicTests }) {
  const context = spec.review_context_paths.map((relativePath) => {
    const absolute = path.join(workspace, relativePath);
    if (!fs.statSync(absolute, { throwIfNoEntry: false })?.isFile()) {
      throw new Error(`Review context file does not exist: ${relativePath}`);
    }
    return `## ${relativePath}\n${fs.readFileSync(absolute, "utf8")}`;
  });
  const source = fs.readFileSync(path.join(workspace, spec.source_path), "utf8");
  const publicEvidence = spec.public_tests.map((name) =>
    `- ${name}: ${publicTests.results[name] ? "passed" : "failed"}`
  ).join("\n");
  return `${spec.task_prompt.trim()}\n\n${context.join("\n\n")}\n\n## Frozen direct implementation: ${spec.source_path}\n${source}\n\n## Direct patch\n${directPatch || "(no diff)"}\n\n## Public harness results\n${publicEvidence}\n\nReview this frozen direct implementation. Use only the public contract, source, diff, and public results above. Identify the single highest-priority material concern first, then any essential secondary concern. Do not assume access to undisclosed tests or tools.`;
}

async function runAdvisorReview({
  cwd,
  advisor,
  title,
  dataHome,
  configHome,
  authState,
  prompt,
}) {
  const review = await runOpenCodeTurn({
    cwd,
    ...advisor,
    agent: "swift_advisor",
    title,
    dataHome,
    configHome,
    authState,
    prompt,
  });
  if (review.metrics.tool_calls !== 0) {
    review.status = "protocol_violation";
    review.error = "Advisor attempted a tool call despite the tool-less protocol";
  }
  return {
    ...review,
    prompt_sha256: createHash("sha256").update(prompt).digest("hex"),
    word_count: review.text.trim().split(/\s+/).filter(Boolean).length,
  };
}

async function runReviewRevision({
  cwd,
  spec,
  candidate,
  session,
  advice,
  title,
  dataHome,
  configHome,
  authState,
}) {
  const prompt = `An independent advisor reviewed the frozen direct implementation and returned the guidance below. Reconcile it against the public contract and source; do not accept it blindly. Make one revision in ${spec.source_path} if a material correction is justified. Work only in that file. Do not call an advisor, delegate, or claim to have run tests. Report the resulting decision and implementation.\n\n[advisor review]\n${advice}`;
  const turn = await runOpenCodeTurn({
    cwd,
    ...candidate,
    title,
    dataHome,
    configHome,
    authState,
    prompt,
    session,
  });
  const tests = await runSwiftTests(cwd);
  return {
    ...turn,
    prompt_sha256: createHash("sha256").update(prompt).digest("hex"),
    public_tests: publicTestSummary(tests, spec),
    test_output: tests.output,
  };
}

function diffFrozenSources(beforePath, afterPath) {
  const result = Bun.spawnSync(
    ["diff", "-u", "--label", "direct", "--label", "reviewed", beforePath, afterPath],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0 && result.exitCode !== 1) {
    throw new Error(`Cannot diff frozen sources: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function command(command, cwd, env = process.env) {
  const result = Bun.spawnSync(command, {
    cwd,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

function preflightModelRoute({ selection, fixtureDir, configHome, dataHome }) {
  const catalogWorkspace = path.join(path.dirname(configHome), "catalog-workspace");
  ensurePrivateDirectory(catalogWorkspace);
  const provider = selection.model.split("/", 1)[0];
  const catalog = command(
    openCodeCommand(["models", provider, "--verbose"]),
    catalogWorkspace,
    isolatedOpenCodeEnvironment({
      configContent: benchmarkConfig(fixtureDir),
      configHome,
      dataHome,
      authContent: "{}",
      cwd: catalogWorkspace,
    }),
  );
  return resolveBenchmarkModelRoute(catalog, selection);
}

function prepareWorkspace(fixtureDir, workspace) {
  fs.rmSync(workspace, { recursive: true, force: true });
  ensurePrivateDirectory(workspace);
  fs.cpSync(fixtureDir, workspace, {
    recursive: true,
    filter: (source) => path.basename(source) !== ".build",
  });
  for (const filePath of fs.readdirSync(workspace, { recursive: true })) {
    const absolute = path.join(workspace, filePath);
    const stat = fs.statSync(absolute);
    fs.chmodSync(absolute, stat.isDirectory() ? 0o700 : 0o600);
  }
  command(["git", "init", "--quiet"], workspace);
  command(["git", "config", "user.email", "benchmark@example.invalid"], workspace);
  command(["git", "config", "user.name", "Benchmark"], workspace);
  command(["git", "add", "-A"], workspace);
  command(["git", "commit", "--quiet", "-m", "fixture"], workspace);
}

function prepareFixtureSnapshot(fixtureDir, outputDir) {
  const snapshot = path.join(outputDir, "fixture-snapshot");
  fs.rmSync(snapshot, { recursive: true, force: true });
  ensurePrivateDirectory(snapshot);
  fs.cpSync(fixtureDir, snapshot, {
    recursive: true,
    filter: (source) => path.basename(source) !== ".build",
  });
  for (const filePath of fs.readdirSync(snapshot, { recursive: true })) {
    const absolute = path.join(snapshot, filePath);
    const stat = fs.statSync(absolute);
    fs.chmodSync(absolute, stat.isDirectory() ? 0o500 : 0o400);
  }
  fs.chmodSync(snapshot, 0o500);
  return snapshot;
}

function sandboxProfile(cwd) {
  const home = os.homedir().replaceAll('"', '\\"');
  const workspace = cwd.replaceAll('"', '\\"');
  const trialDirectory = path.dirname(cwd).replaceAll('"', '\\"');
  const benchmarkDirectory = path.dirname(path.dirname(cwd)).replaceAll('"', '\\"');
  if (cwd === home || cwd.startsWith(`${home}${path.sep}`)) {
    throw new Error("Benchmark workspaces must live outside the real HOME directory");
  }
  return [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    `(deny file-read* (subpath "${home}"))`,
    `(deny file-write* (subpath "${home}"))`,
    `(deny file-read* (subpath "${benchmarkDirectory}"))`,
    `(deny file-write* (subpath "${benchmarkDirectory}"))`,
    `(allow file-read* file-write* (subpath "${trialDirectory}"))`,
    `(allow file-read* file-write* (subpath "${workspace}"))`,
  ].join("\n");
}

async function runSwiftTests(cwd) {
  const started = performance.now();
  const runtimeDirectory = path.join(path.dirname(cwd), "test-runtime");
  const cacheDirectory = path.join(runtimeDirectory, "cache");
  const configDirectory = path.join(runtimeDirectory, "config");
  const securityDirectory = path.join(runtimeDirectory, "security");
  for (const directory of [
    runtimeDirectory,
    cacheDirectory,
    configDirectory,
    securityDirectory,
  ]) {
    ensurePrivateDirectory(directory);
  }
  const execution = await runWithTimeout(
    [
      "sandbox-exec",
      "-p",
      sandboxProfile(cwd),
      "swift",
      "test",
      "--disable-sandbox",
      "--cache-path",
      cacheDirectory,
      "--config-path",
      configDirectory,
      "--security-path",
      securityDirectory,
      "--scratch-path",
      path.join(cwd, ".build"),
    ],
    { cwd, env: sanitizedTestEnvironment(runtimeDirectory) },
    30_000,
  );
  const output = `${execution.stdout}\n${execution.stderr}`;
  return {
    exit_code: execution.exitCode,
    timed_out: execution.timedOut,
    wall_time_seconds: (performance.now() - started) / 1000,
    output,
  };
}

function testResults(output, spec) {
  return Object.fromEntries(Object.keys(spec.test_weights).map((name) => [
    name,
    new RegExp(`(?:^|\\n)[^\\n]*Test ${name}\\(\\) passed(?: after [^\\n]*)?(?:\\n|$)`)
      .test(output),
  ]));
}

function grade({
  workspace,
  spec,
  testOutput,
  baselineFiles,
  publicTests,
  hiddenTests,
  stageStatus,
}) {
  const results = testResults(testOutput, spec);
  const source = fs.readFileSync(path.join(workspace, spec.source_path), "utf8");
  const changedFiles = command(["git", "diff", "--name-only", "HEAD"], workspace)
    .trim()
    .split("\n")
    .filter(Boolean);
  const statusPaths = command(
    ["git", "status", "--porcelain=v1", "--untracked-files=all"],
    workspace,
  ).split("\n").filter(Boolean).map((line) => line.slice(3));
  const unexpectedFiles = [...new Set([...changedFiles, ...statusPaths])]
    .filter((file) => file !== spec.source_path)
    .sort();
  const currentTrackedFiles = command(["git", "ls-files"], workspace)
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  const bannedPatterns = spec.banned_source_patterns.filter(
    (pattern) => source.includes(pattern),
  );
  const buildPassed = /Build complete!/.test(testOutput);
  const testPoints = Object.entries(spec.test_weights).reduce(
    (total, [name, points]) => total + (results[name] ? points : 0),
    0,
  );
  const fileSetPreserved = JSON.stringify(currentTrackedFiles) === JSON.stringify(baselineFiles);
  const compliancePassed = unexpectedFiles.length === 0 &&
    bannedPatterns.length === 0 &&
    fileSetPreserved;
  let score = testPoints + (buildPassed ? 10 : 0) + (compliancePassed ? 10 : 0);
  const criticalPassed = spec.critical_tests.every((name) => results[name]);
  if (!criticalPassed) score = Math.min(score, spec.critical_failure_score_cap);
  const publicSuitePassed = publicTests.exit_code === 0 &&
    !publicTests.timed_out &&
    spec.public_tests.every((name) => publicTests.results[name]);
  const hiddenSuitePassed = hiddenTests.exit_code === 0 && !hiddenTests.timed_out;
  return {
    score,
    quality_floor_passed: score >= spec.quality_floor_score &&
      stageStatus === "completed" &&
      publicSuitePassed &&
      hiddenSuitePassed &&
      criticalPassed &&
      compliancePassed,
    build_passed: buildPassed,
    public_suite_passed: publicSuitePassed,
    hidden_suite_passed: hiddenSuitePassed,
    critical_passed: criticalPassed,
    compliance_passed: compliancePassed,
    tests: results,
    changed_files: changedFiles,
    unexpected_files: unexpectedFiles,
    banned_patterns: bannedPatterns,
    tracked_file_set_preserved: fileSetPreserved,
  };
}

async function runTrial({
  name,
  candidate,
  advisor,
  spec,
  specHash,
  repetition,
  fixtureDir,
  hiddenTest,
  outputDir,
  dataHome,
  configHome,
  authState,
  fixtureHash,
  hiddenTestHash,
  runnerHash,
  openCodeVersion,
  modelRoute,
  advisorRoute,
  environmentHash,
  seed,
  selectedCohort,
  orderPosition,
}) {
  const fingerprint = createHash("sha256").update(JSON.stringify({
    schema: 6,
    candidate,
    advisor,
    benchmarkSpecHash: specHash,
    repetition,
    fixtureHash,
    hiddenTestHash,
    runnerHash,
    openCodeVersion,
    modelRouteHash: modelRoute.sha256,
    advisorRouteHash: advisorRoute?.sha256 ?? null,
    environmentHash,
    schedule: {
      seed,
      selected_cohort: selectedCohort,
      block: repetition,
      order_position: orderPosition,
    },
    benchmarkConfig: benchmarkConfigFingerprint(fixtureDir),
  })).digest("hex");
  const trial = `swift-${name}-r${repetition}-${fingerprint.slice(0, 10)}`;
  const trialDir = path.join(outputDir, trial);
  const resultPath = path.join(trialDir, "result.json");
  if (fs.existsSync(resultPath)) {
    const saved = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    if (saved.fingerprint === fingerprint) {
      console.log(`REUSE  ${trial} ${saved.evaluation.score}/100 direct`);
      return saved;
    }
  }
  const workspace = path.join(trialDir, "workspace");
  prepareWorkspace(fixtureDir, workspace);
  const baseline = await runSwiftTests(workspace);
  writePrivateFile(path.join(trialDir, "baseline-tests.txt"), baseline.output);
  validateBaselineResult(baseline, spec, trial);
  console.log(`START  ${trial}`);
  const stage = await runImplementation({
    cwd: workspace,
    spec,
    ...candidate,
    title: trial,
    dataHome,
    configHome,
    authState,
  });
  writePrivateFile(
    path.join(trialDir, "events.jsonl"),
    `${stage.events.map((event) => JSON.stringify(event)).join("\n")}\n`,
  );
  writePrivateFile(path.join(trialDir, "answer.md"), `${stage.text}\n`);

  const directPublicTests = stage.test_attempts.at(-1);
  for (const [index, attempt] of stage.test_attempts.entries()) {
    writePrivateFile(
      path.join(trialDir, `public-tests-attempt-${index + 1}.txt`),
      attempt.output,
    );
  }
  const directPublicSummary = publicTestSummary(directPublicTests, spec);
  const directSourcePath = path.join(trialDir, "direct-source.swift");
  writePrivateFile(
    directSourcePath,
    fs.readFileSync(path.join(workspace, spec.source_path)),
  );
  const direct = await evaluateFrozenWorkspace({
    fixtureDir,
    hiddenTest,
    implementationWorkspace: workspace,
    trialDir,
    artifactName: "direct",
    spec,
    publicTests: directPublicSummary,
    stageStatus: stage.status,
  });
  writePrivateFile(
    path.join(trialDir, "patch.diff"),
    fs.readFileSync(path.join(trialDir, "direct.patch.diff")),
  );
  writePrivateFile(
    path.join(trialDir, "hidden-tests.txt"),
    fs.readFileSync(path.join(trialDir, "direct-hidden-tests.txt")),
  );

  const { events, test_attempts: _testAttempts, ...stageSummary } = stage;
  const result = {
    trial,
    fingerprint,
    repetition,
    candidate: name,
    model: candidate,
    advisor,
    benchmark_id: spec.benchmark_id,
    schedule: {
      seed,
      selected_cohort: selectedCohort,
      block: repetition,
      order_position: orderPosition,
    },
    stage: stageSummary,
    public_tests: directPublicSummary,
    hidden_tests: direct.hidden_tests,
    evaluation: direct.evaluation,
    provenance: {
      direct_source_sha256: createHash("sha256").update(
        fs.readFileSync(directSourcePath),
      ).digest("hex"),
      direct_patch_sha256: direct.patch_sha256,
      hidden_test_sha256: hiddenTestHash,
      hidden_test_disclosed_to_advisor: false,
    },
    routes: {
      direct: {
        status: stage.status,
        stages: { implementation: stageSummary },
        public_tests: directPublicSummary,
        hidden_tests: direct.hidden_tests,
        evaluation: direct.evaluation,
        totals: combinedMetrics(
          [stage],
          "counterfactual_direct_route_cost",
        ),
      },
    },
  };

  if (advisor) {
    const directPatch = fs.readFileSync(
      path.join(trialDir, "direct.patch.diff"),
      "utf8",
    );
    const reviewPrompt = advisorReviewPrompt({
      workspace,
      spec,
      directPatch,
      publicTests: directPublicSummary,
    });
    const hiddenTestSource = fs.readFileSync(hiddenTest, "utf8");
    if (reviewPrompt.includes(hiddenTestSource)) {
      throw new Error("Advisor prompt unexpectedly contains the locked hidden test source");
    }
    writePrivateFile(
      path.join(trialDir, "advisor-prompt.md"),
      `${reviewPrompt}\n`,
    );
    const advice = await runAdvisorReview({
      cwd: workspace,
      advisor,
      title: `${trial}-advisor`,
      dataHome,
      configHome,
      authState,
      prompt: reviewPrompt,
    });
    writeStageArtifacts(trialDir, "advisor", advice);
    const adviceSummary = withoutEvents(advice);
    result.provenance.advisor_prompt_sha256 = advice.prompt_sha256;
    result.provenance.advisor_response_sha256 = createHash("sha256")
      .update(advice.text)
      .digest("hex");

    if (advice.status !== "completed" || !stage.session_id) {
      result.routes.reviewed = {
        status: advice.status === "completed"
          ? "implementation_session_unavailable"
          : "advisor_failed",
        advisor_failure: advice.status === "completed"
          ? { status: "session_unavailable" }
          : {
              status: advice.status,
              timed_out: advice.status === "timeout",
              exit_code: advice.exit_code,
              error: advice.error,
            },
        stages: {
          implementation: stageSummary,
          advisor: adviceSummary,
        },
        evaluation: null,
        totals: combinedMetrics(
          [stage, advice],
          "counterfactual_reviewed_route_cost_before_revision",
        ),
      };
      result.experiment_totals = combinedMetrics(
        [stage, advice],
        "unique_experiment_stage_cost",
      );
    } else {
      const revision = await runReviewRevision({
        cwd: workspace,
        spec,
        candidate,
        session: stage.session_id,
        advice: advice.text,
        title: `${trial}-review-reconciliation`,
        dataHome,
        configHome,
        authState,
      });
      writeStageArtifacts(trialDir, "revision", revision);
      writePrivateFile(
        path.join(trialDir, "reviewed-public-tests.txt"),
        revision.test_output,
      );
      const reviewedSourcePath = path.join(trialDir, "reviewed-source.swift");
      writePrivateFile(
        reviewedSourcePath,
        fs.readFileSync(path.join(workspace, spec.source_path)),
      );
      writePrivateFile(
        path.join(trialDir, "advisor-revision.diff"),
        diffFrozenSources(directSourcePath, reviewedSourcePath),
      );
      const reviewed = await evaluateFrozenWorkspace({
        fixtureDir,
        hiddenTest,
        implementationWorkspace: workspace,
        trialDir,
        artifactName: "reviewed",
        spec,
        publicTests: revision.public_tests,
        stageStatus: revision.status,
      });
      const {
        events: _revisionEvents,
        test_output: _revisionTestOutput,
        ...revisionSummary
      } = revision;
      result.provenance.reviewed_source_sha256 = createHash("sha256")
        .update(fs.readFileSync(reviewedSourcePath))
        .digest("hex");
      result.provenance.reviewed_patch_sha256 = reviewed.patch_sha256;
      result.provenance.advisor_revision_diff_sha256 = createHash("sha256")
        .update(fs.readFileSync(path.join(trialDir, "advisor-revision.diff")))
        .digest("hex");
      result.routes.reviewed = {
        status: revision.status === "completed" ? "completed" : "revision_failed",
        advisor_failure: null,
        stages: {
          implementation: stageSummary,
          advisor: adviceSummary,
          revision: revisionSummary,
        },
        public_tests: revision.public_tests,
        hidden_tests: reviewed.hidden_tests,
        evaluation: reviewed.evaluation,
        totals: combinedMetrics(
          [stage, advice, revision],
          "counterfactual_reviewed_route_cost_including_shared_direct_implementation",
        ),
      };
      result.experiment_totals = combinedMetrics(
        [stage, advice, revision],
        "unique_experiment_stage_cost",
      );
    }
  } else {
    result.experiment_totals = combinedMetrics(
      [stage],
      "unique_experiment_stage_cost",
    );
  }
  writePrivateFile(
    resultPath,
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(
    `DONE   ${trial} ${direct.evaluation.score}/100 direct${result.routes.reviewed?.evaluation ? ` -> ${result.routes.reviewed.evaluation.score}/100 reviewed` : ""} $${result.experiment_totals.recomputed_cost_usd.toFixed(4)}`,
  );
  return result;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  openCodeLauncher = args.opencode_launcher ?? "direct";
  if (!["direct", "notion-local"].includes(openCodeLauncher)) {
    throw new Error("--opencode-launcher must be direct or notion-local");
  }
  if (!args.output_dir) throw new Error("Missing --output-dir");
  let outputDir = assertRawBenchmarkOutputOutsideRepository(args.output_dir);
  const {
    spec,
    fixtureDir: sourceFixtureDir,
    hiddenTest,
    manifestPath,
    manifestHash,
  } = loadBenchmarkSpec(args);
  const validateOnly = isEnabled(args.validate_only);
  const singleBlock = isEnabled(args.single_block);
  if (
    !validateOnly &&
    (!Number.isInteger(args.repeat) || args.repeat < (singleBlock ? 1 : 2))
  ) {
    throw new Error(
      `--repeat must be an integer of at least ${singleBlock ? 1 : 2}`,
    );
  }
  if (!validateOnly && singleBlock && args.repeat !== 1) {
    throw new Error("--single-block requires --repeat 1");
  }
  ensurePrivateDirectory(outputDir);
  outputDir = assertRawBenchmarkOutputOutsideRepository(outputDir);
  const sourceFixtureHash = hashTree(sourceFixtureDir, new Set([".build"]));
  const fixtureDir = prepareFixtureSnapshot(sourceFixtureDir, outputDir);
  const specHash = createHash("sha256")
    .update(JSON.stringify(spec))
    .digest("hex");
  const advisor = advisorConfiguration(args);
  const selected = args.models
    ? args.models.split(",").map((name) => name.trim()).filter(Boolean)
    : DEFAULT_CANDIDATES;
  if (selected.length === 0 || new Set(selected).size !== selected.length) {
    throw new Error("--models must contain at least one candidate with no duplicates");
  }
  for (const name of selected) {
    if (!candidates[name]) throw new Error(`Unknown model candidate: ${name}`);
  }
  if (!validateOnly && !singleBlock && args.repeat % selected.length !== 0) {
    throw new Error(
      `--repeat must be a multiple of the ${selected.length}-arm selected cohort to complete the Latin-square schedule`,
    );
  }

  if (validateOnly) {
    const validationWorkspace = path.join(
      outputDir,
      "fixture-validation",
      "workspace",
    );
    prepareWorkspace(fixtureDir, validationWorkspace);
    validateToolPathGuard(validationWorkspace);
    const baseline = await runSwiftTests(validationWorkspace);
    writePrivateFile(
      path.join(outputDir, "fixture-validation", "baseline-tests.txt"),
      baseline.output,
    );
    validateBaselineResult(baseline, spec, `${spec.benchmark_id} validation`);
    command(["swiftc", "-parse", hiddenTest], process.cwd());
    const hiddenValidation = await evaluateFrozenWorkspace({
      fixtureDir,
      hiddenTest,
      implementationWorkspace: validationWorkspace,
      trialDir: path.join(outputDir, "fixture-validation"),
      artifactName: "baseline",
      spec,
      publicTests: publicTestSummary(baseline, spec),
      stageStatus: "completed",
    });
    if (
      hiddenValidation.hidden_tests.timed_out ||
      !hiddenValidation.evaluation.build_passed
    ) {
      throw new Error("Hidden suite failed to build or timed out during validation");
    }
    writePrivateFile(
      path.join(outputDir, "fixture-validation", "result.json"),
      `${JSON.stringify({
        status: "valid",
        benchmark_id: spec.benchmark_id,
        fixture_sha256: sourceFixtureHash,
        hidden_test_sha256: createHash("sha256")
          .update(fs.readFileSync(hiddenTest))
          .digest("hex"),
        benchmark_spec_sha256: specHash,
        manifest_sha256: manifestHash,
        selected_candidates: selected,
        candidate_efforts: Object.fromEntries(selected.map((name) => [
          name,
          candidates[name].effort,
        ])),
        advisor,
        hidden_suite_build_passed: hiddenValidation.evaluation.build_passed,
        hidden_suite_exit_code: hiddenValidation.hidden_tests.exit_code,
        tool_path_guard_passed: true,
      }, null, 2)}\n`,
    );
    console.log(`VALID  ${spec.benchmark_id} fixture and hidden-test syntax`);
    return;
  }

  const dataHome = preparePrivateDataHome(outputDir);
  const configHome = preparePrivateConfigHome(outputDir);
  const authState = { content: loadOpenCodeAuthContent() };

  const metadata = {
    protocol: advisor
      ? "controlled-swift-direct-review-revision-v1"
      : "controlled-swift-direct-patch-v3",
    protocol_limits:
      "The implementer has no shell or external-directory access. A fixed harness runs model-authored Swift in a network-denied sandbox with an empty HOME and may supply public diagnostics for at most two initial revisions. Direct output is frozen and evaluated in an isolated clone. When configured, a tool-less advisor receives only public contract/source evidence, and the same implementer session gets one reconciliation turn before an identically locked hidden-suite evaluation in a second isolated clone.",
    benchmark_id: spec.benchmark_id,
    benchmark_spec_sha256: specHash,
    manifest_path: manifestPath,
    manifest_sha256: manifestHash,
    seed: args.seed,
    opencode_launcher: openCodeLauncher,
    repeat: args.repeat,
    sampling_class: singleBlock
      ? "exploratory_single_block"
      : "balanced_latin_square",
    order_balance_complete: !singleBlock,
    selected,
    candidate_efforts: Object.fromEntries(selected.map((name) => [
      name,
      candidates[name].effort,
    ])),
    advisor,
    fixture_sha256: sourceFixtureHash,
    hidden_test_sha256: createHash("sha256").update(fs.readFileSync(hiddenTest)).digest("hex"),
    runner_sha256: createHash("sha256")
      .update(fs.readFileSync(new URL(import.meta.url)))
      .digest("hex"),
    opencode_version: command(openCodeCommand(["--version"]), process.cwd()).trim(),
    swift_version: command(["swift", "--version"], process.cwd()).trim(),
    xcode_version: command(["xcodebuild", "-version"], process.cwd()).trim(),
    sdk_version: command(["xcrun", "--show-sdk-version"], process.cwd()).trim(),
    os_version: command(["sw_vers"], process.cwd()).trim(),
    architecture: command(["uname", "-m"], process.cwd()).trim(),
    cost_protocol:
      "Normalized list-price cost per completed request; OpenAI input context above 272k is repriced at 2x input/cache and 1.5x output. GPT-5.5 requests with cache-write usage retain event-reported cost because no defensible cache-write rate is pinned. Each reviewed-route total includes its shared direct implementation as the counterfactual cost of choosing that route.",
    advisor_system_sha256: advisor
      ? createHash("sha256").update(ADVISOR_SYSTEM).digest("hex")
      : null,
    global_instructions:
      "Project/global OpenCode config excluded; fixture-root AGENTS.md explicitly locked when present.",
    benchmark_instructions: benchmarkInstructionManifest(fixtureDir),
    fingerprint_schema: 6,
    fingerprint_compatibility:
      "Route-provenance schema changes intentionally invalidate Swift trial fingerprints from earlier schemas.",
  };
  metadata.environment_sha256 = createHash("sha256").update(JSON.stringify({
    opencode: metadata.opencode_version,
    swift: metadata.swift_version,
    xcode: metadata.xcode_version,
    sdk: metadata.sdk_version,
    os: metadata.os_version,
    architecture: metadata.architecture,
  })).digest("hex");
  const results = [];
  const modelRoutes = Object.fromEntries(selected.map((name) => [
    name,
    preflightModelRoute({
      selection: candidates[name],
      fixtureDir,
      configHome,
      dataHome,
    }),
  ]));
  const advisorRoute = advisor
    ? preflightModelRoute({
      selection: advisor,
      fixtureDir,
      configHome,
      dataHome,
    })
    : null;
  metadata.model_routes = {
    candidates: Object.fromEntries(selected.map((name) => [name, {
      ...modelRoutes[name],
      selected_variant: candidates[name].variant ?? null,
    }])),
    advisor: advisorRoute
      ? { ...advisorRoute, selected_variant: advisor.variant ?? null }
      : null,
  };
  metadata.model_route_sha256 = {
    candidates: Object.fromEntries(selected.map((name) => [
      name,
      modelRoutes[name].sha256,
    ])),
    advisor: advisorRoute?.sha256 ?? null,
  };
  writePrivateFile(
    path.join(outputDir, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  try {
    for (let repetition = 1; repetition <= args.repeat; repetition += 1) {
      const order = latinSquareOrder(selected, args.seed, repetition);
      for (const [orderPosition, name] of order.entries()) {
        results.push(await runTrial({
          name,
          candidate: candidates[name],
          advisor,
          spec,
          specHash,
          repetition,
          fixtureDir,
          hiddenTest,
          outputDir,
          dataHome,
          configHome,
          authState,
          fixtureHash: metadata.fixture_sha256,
          hiddenTestHash: metadata.hidden_test_sha256,
          runnerHash: metadata.runner_sha256,
          openCodeVersion: metadata.opencode_version,
          modelRoute: modelRoutes[name],
          advisorRoute,
          environmentHash: metadata.environment_sha256,
          seed: args.seed,
          selectedCohort: selected,
          orderPosition,
        }));
      }
    }
  } finally {
    absorbAndScrubPersistedAuth(dataHome, authState);
  }
  writePrivateFile(
    path.join(outputDir, "summary.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  if (fs.existsSync(path.join(dataHome, "opencode", "auth.json"))) {
    throw new Error("Benchmark output retained a copied OpenCode auth file");
  }
}

if (import.meta.main) {
  await main();
}
