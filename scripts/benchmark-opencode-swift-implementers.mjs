#!/usr/bin/env bun

import fs from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";

process.umask(0o077);

const candidates = {
  sonnet: { model: "anthropic/claude-sonnet-5" },
  luna: { model: "openai/gpt-5.6-luna", variant: "xhigh" },
  terra: { model: "openai/gpt-5.6-terra", variant: "xhigh" },
};

const OPENAI_PRICING = {
  "openai/gpt-5.6-luna": {
    input: 1,
    output: 6,
    cache_read: 0.1,
    cache_write: 1.25,
  },
  "openai/gpt-5.6-terra": {
    input: 2.5,
    output: 15,
    cache_read: 0.25,
    cache_write: 3.125,
  },
};
const OPENAI_LONG_CONTEXT_THRESHOLD = 272000;
const SOURCE_PATH = path.join("Sources", "ReliablePager", "FeedPager.swift");
const HIDDEN_TEST_PATH = path.join(
  "Tests",
  "ReliablePagerTests",
  "HiddenFeedPagerTests.swift",
);
const BANNED_SOURCE_PATTERNS = [
  "@unchecked Sendable",
  "nonisolated(unsafe)",
  "Task.detached",
  "Task.sleep",
  "Thread.sleep",
  "usleep",
  "DispatchSemaphore",
  "#if compiler",
];
const TEST_WEIGHTS = {
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
};
const PUBLIC_TESTS = [
  "sequentialPaginationStopsAtEnd",
  "failureRetriesCommittedCursor",
  "concurrentLoadsShareRequest",
  "resetCancelsAndRejectsLateResponse",
  "deduplicatesWithinAndAcrossPages",
];

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function writePrivateFile(filePath, contents) {
  ensurePrivateDirectory(path.dirname(filePath));
  fs.writeFileSync(filePath, contents, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
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
  const globalInstructions = path.join(os.homedir(), ".config", "opencode", "AGENTS.md");
  if (fs.existsSync(globalInstructions)) {
    writePrivateFile(
      path.join(openCodeConfig, "AGENTS.md"),
      fs.readFileSync(globalInstructions),
    );
  }
  return configHome;
}

function loadAuthContent() {
  if (process.env.OPENCODE_AUTH_CONTENT) return process.env.OPENCODE_AUTH_CONTENT;
  const sourceDataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share");
  return fs.readFileSync(path.join(sourceDataHome, "opencode", "auth.json"), "utf8");
}

function absorbAndScrubPersistedAuth(dataHome, authState) {
  const authPath = path.join(dataHome, "opencode", "auth.json");
  if (!fs.existsSync(authPath)) return;
  authState.content = fs.readFileSync(authPath, "utf8");
  fs.rmSync(authPath, { force: true });
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

function readOptionalConfig(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const source = fs.readFileSync(filePath, "utf8");
  return Bun.JSONC.parse(source);
}

function disabledBenchmarkMcps(cwd) {
  const paths = [
    path.join(os.homedir(), ".config", "opencode", "opencode.json"),
    path.join(os.homedir(), ".config", "opencode", "opencode.jsonc"),
    path.join(cwd, "opencode.json"),
    path.join(cwd, "opencode.jsonc"),
    path.join(cwd, ".opencode", "opencode.json"),
    path.join(cwd, ".opencode", "opencode.jsonc"),
  ];
  const names = new Set();
  for (const configPath of paths) {
    const config = readOptionalConfig(configPath);
    for (const name of Object.keys(config.mcp ?? {})) names.add(name);
  }
  return Object.fromEntries([...names].sort().map((name) => [name, { enabled: false }]));
}

function benchmarkConfig(cwd) {
  return JSON.stringify({
    snapshot: false,
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
    },
    permission: {
      advisor: "deny",
      task: "deny",
      todowrite: "deny",
      create_goal: "deny",
      set_goal: "deny",
      update_goal_objective: "deny",
      update_goal: "deny",
      update_goal_status: "deny",
      clear_goal: "deny",
    },
  });
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
  const workspace = `${path.resolve(cwd)}${path.sep}`;
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
      if (resolved !== path.resolve(cwd) && !`${resolved}${path.sep}`.startsWith(workspace)) {
        throw new Error(
          `Model tool attempted to access a path outside its trial workspace: ${value}`,
        );
      }
    }
  }
}

function recomputedRequestCost(event, model) {
  const pricing = OPENAI_PRICING[model];
  if (!pricing) return Number(event.part?.cost ?? 0);
  const tokens = event.part?.tokens ?? {};
  const input = Number(tokens.input ?? 0);
  const cacheRead = Number(tokens.cache?.read ?? 0);
  const cacheWrite = Number(tokens.cache?.write ?? 0);
  const output = Number(tokens.output ?? 0) + Number(tokens.reasoning ?? 0);
  const longContext = input + cacheRead + cacheWrite > OPENAI_LONG_CONTEXT_THRESHOLD;
  return (
    input * pricing.input * (longContext ? 2 : 1) +
    cacheRead * pricing.cache_read * (longContext ? 2 : 1) +
    cacheWrite * pricing.cache_write * (longContext ? 2 : 1) +
    output * pricing.output * (longContext ? 1.5 : 1)
  ) / 1_000_000;
}

function summarize(events, wallTimeMs, model) {
  const finishes = events.filter((event) => event.type === "step_finish");
  const tools = events.filter((event) => event.type === "tool_use");
  const sum = (selector) => finishes.reduce(
    (total, event) => total + Number(selector(event) ?? 0),
    0,
  );
  return {
    wall_time_seconds: wallTimeMs / 1000,
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
  title,
  dataHome,
  configHome,
  authState,
  prompt,
  session,
}) {
  const args = [
    "opencode",
    "run",
    "--pure",
    "--agent",
    "swift_implementer",
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
  const started = performance.now();
  const execution = await runWithTimeout(
    args,
    {
      cwd,
      env: {
        ...process.env,
        PWD: cwd,
        INIT_CWD: cwd,
        XDG_DATA_HOME: dataHome,
        XDG_CONFIG_HOME: configHome,
        OPENCODE_AUTH_CONTENT: authState.content,
        OPENCODE_CONFIG_CONTENT: benchmarkConfig(cwd),
      },
    },
    10 * 60 * 1000,
  );
  absorbAndScrubPersistedAuth(dataHome, authState);
  const events = parseEvents(execution.stdout);
  assertToolPathsStayInWorkspace(events, cwd);
  const completed = events.some(
    (event) => event.type === "step_finish" && event.part?.reason === "stop",
  );
  return {
    status: execution.timedOut
      ? "timeout"
      : execution.exitCode !== 0
        ? "failed"
        : completed
          ? "completed"
          : "incomplete",
    exit_code: execution.exitCode,
    session_id: events.find((event) => event.sessionID)?.sessionID,
    text: extractText(events),
    error: execution.exitCode === 0
      ? undefined
      : (execution.stderr || execution.stdout.slice(-2000)),
    metrics: summarize(events, performance.now() - started, model),
    events,
  };
}

async function runImplementation({
  cwd,
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
  let prompt = `Fix the ReliablePager Swift Package so it satisfies its documented behavior.\n\nRead AGENTS.md and README.md before editing. Work only in the permitted file, preserve the public API, and use Swift 6-safe concurrency. Do not add dependencies or weaken tests. The benchmark harness—not your shell—will run the public Swift Package tests after each turn and return failures for revision. Do not call an advisor, create a Goal, or delegate.\n\nInspect and edit the implementation, then report that it is ready for the fixed test harness.`;

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
    const results = testResults(tests.output);
    if (tests.exit_code === 0 && PUBLIC_TESTS.every((name) => results[name])) {
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
  return {
    status: last?.status ?? "failed",
    exit_code: last?.exit_code ?? 1,
    session_id: session,
    text: last?.text ?? "",
    error: last?.error,
    turns: turns.map(({ events: _events, ...turn }) => turn),
    metrics: summarize(events, modelWallMs, model),
    events,
    test_attempts: testAttempts,
  };
}

function command(command, cwd) {
  const result = Bun.spawnSync(command, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(`${command.join(" ")} failed: ${result.stderr.toString()}`);
  }
  return result.stdout.toString();
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

function testResults(output) {
  return Object.fromEntries(Object.keys(TEST_WEIGHTS).map((name) => [
    name,
    new RegExp(`(?:^|\\n)[^\\n]*Test ${name}\\(\\) passed(?: after [^\\n]*)?(?:\\n|$)`)
      .test(output),
  ]));
}

function grade({
  workspace,
  testOutput,
  baselineFiles,
  publicTests,
  hiddenTests,
  stageStatus,
}) {
  const results = testResults(testOutput);
  const source = fs.readFileSync(path.join(workspace, SOURCE_PATH), "utf8");
  const changedFiles = command(["git", "diff", "--name-only", "HEAD"], workspace)
    .trim()
    .split("\n")
    .filter(Boolean);
  const statusPaths = command(
    ["git", "status", "--porcelain=v1", "--untracked-files=all"],
    workspace,
  ).split("\n").filter(Boolean).map((line) => line.slice(3));
  const unexpectedFiles = [...new Set([...changedFiles, ...statusPaths])]
    .filter((file) => file !== SOURCE_PATH)
    .sort();
  const currentTrackedFiles = command(["git", "ls-files"], workspace)
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();
  const bannedPatterns = BANNED_SOURCE_PATTERNS.filter((pattern) => source.includes(pattern));
  const buildPassed = /Build complete!/.test(testOutput);
  const testPoints = Object.entries(TEST_WEIGHTS).reduce(
    (total, [name, points]) => total + (results[name] ? points : 0),
    0,
  );
  const fileSetPreserved = JSON.stringify(currentTrackedFiles) === JSON.stringify(baselineFiles);
  const compliancePassed = unexpectedFiles.length === 0 &&
    bannedPatterns.length === 0 &&
    fileSetPreserved;
  let score = testPoints + (buildPassed ? 10 : 0) + (compliancePassed ? 10 : 0);
  const criticalPassed = results.concurrentLoadsShareRequest &&
    results.resetThenReloadProtectsTheNewGeneration &&
    results.staleFailureAfterResetDoesNotClearFreshLoad;
  if (!criticalPassed) score = Math.min(score, 69);
  const publicSuitePassed = publicTests.exit_code === 0 &&
    !publicTests.timed_out &&
    PUBLIC_TESTS.every((name) => publicTests.results[name]);
  const hiddenSuitePassed = hiddenTests.exit_code === 0 && !hiddenTests.timed_out;
  return {
    score,
    quality_floor_passed: score >= 85 &&
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
  modelCatalogHash,
  globalInstructionsHash,
  environmentHash,
}) {
  const fingerprint = createHash("sha256").update(JSON.stringify({
    schema: 3,
    candidate,
    repetition,
    fixtureHash,
    hiddenTestHash,
    runnerHash,
    openCodeVersion,
    modelCatalogHash,
    globalInstructionsHash,
    environmentHash,
    benchmarkConfig: benchmarkConfig(fixtureDir),
  })).digest("hex");
  const trial = `swift-${name}-r${repetition}-${fingerprint.slice(0, 10)}`;
  const trialDir = path.join(outputDir, trial);
  const resultPath = path.join(trialDir, "result.json");
  if (fs.existsSync(resultPath)) {
    const saved = JSON.parse(fs.readFileSync(resultPath, "utf8"));
    if (saved.fingerprint === fingerprint) {
      console.log(`REUSE  ${trial} ${saved.evaluation.score}/100`);
      return saved;
    }
  }
  const workspace = path.join(trialDir, "workspace");
  prepareWorkspace(fixtureDir, workspace);
  const baselineFiles = command(["git", "ls-files"], workspace)
    .trim()
    .split("\n")
    .filter(Boolean)
    .sort();

  const baseline = await runSwiftTests(workspace);
  writePrivateFile(path.join(trialDir, "baseline-tests.txt"), baseline.output);
  const baselineResults = testResults(baseline.output);
  const expectedBaseline = {
    sequentialPaginationStopsAtEnd: true,
    failureRetriesCommittedCursor: true,
    concurrentLoadsShareRequest: false,
    resetCancelsAndRejectsLateResponse: false,
    deduplicatesWithinAndAcrossPages: false,
  };
  if (baseline.exit_code === 0 || baseline.timed_out ||
    !/Build complete!/.test(baseline.output) ||
    Object.entries(expectedBaseline).some(
      ([test, expected]) => baselineResults[test] !== expected,
    )) {
    throw new Error(`Fixture baseline contract changed for ${trial}`);
  }
  console.log(`START  ${trial}`);
  const stage = await runImplementation({
    cwd: workspace,
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

  const publicTests = stage.test_attempts.at(-1);
  for (const [index, attempt] of stage.test_attempts.entries()) {
    writePrivateFile(
      path.join(trialDir, `public-tests-attempt-${index + 1}.txt`),
      attempt.output,
    );
  }
  fs.copyFileSync(hiddenTest, path.join(workspace, HIDDEN_TEST_PATH));
  fs.chmodSync(path.join(workspace, HIDDEN_TEST_PATH), 0o600);
  const hiddenTests = await runSwiftTests(workspace);
  fs.rmSync(path.join(workspace, HIDDEN_TEST_PATH), { force: true });
  writePrivateFile(path.join(trialDir, "hidden-tests.txt"), hiddenTests.output);
  const publicTestSummary = {
    exit_code: publicTests.exit_code,
    timed_out: publicTests.timed_out,
    wall_time_seconds: publicTests.wall_time_seconds,
    results: testResults(publicTests.output),
  };
  const evaluation = grade({
    workspace,
    testOutput: hiddenTests.output,
    baselineFiles,
    publicTests: publicTestSummary,
    hiddenTests,
    stageStatus: stage.status,
  });
  const diff = command(["git", "diff", "--", SOURCE_PATH], workspace);
  writePrivateFile(path.join(trialDir, "patch.diff"), diff);

  const { events, test_attempts: _testAttempts, ...stageSummary } = stage;
  const result = {
    trial,
    fingerprint,
    repetition,
    candidate: name,
    model: candidate,
    stage: stageSummary,
    public_tests: publicTestSummary,
    hidden_tests: {
      exit_code: hiddenTests.exit_code,
      timed_out: hiddenTests.timed_out,
      wall_time_seconds: hiddenTests.wall_time_seconds,
    },
    evaluation,
  };
  writePrivateFile(
    resultPath,
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(
    `DONE   ${trial} ${evaluation.score}/100 $${stage.metrics.recomputed_cost_usd.toFixed(4)} ${stage.metrics.wall_time_seconds.toFixed(1)}s ${stage.metrics.tool_calls} tools`,
  );
  return result;
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  for (const required of ["fixture_dir", "hidden_test_file", "output_dir"]) {
    if (!args[required]) throw new Error(`Missing --${required.replaceAll("_", "-")}`);
  }
  if (!Number.isInteger(args.repeat) || args.repeat < 2) {
    throw new Error("--repeat must be an integer of at least 2");
  }
  const sourceFixtureDir = path.resolve(args.fixture_dir);
  const hiddenTest = path.resolve(args.hidden_test_file);
  const outputDir = path.resolve(args.output_dir);
  ensurePrivateDirectory(outputDir);
  const sourceFixtureHash = hashTree(sourceFixtureDir, new Set([".build"]));
  const fixtureDir = prepareFixtureSnapshot(sourceFixtureDir, outputDir);
  const dataHome = preparePrivateDataHome(outputDir);
  const configHome = preparePrivateConfigHome(outputDir);
  const authState = { content: loadAuthContent() };
  const selected = args.models
    ? args.models.split(",").map((name) => name.trim()).filter(Boolean)
    : Object.keys(candidates);
  for (const name of selected) {
    if (!candidates[name]) throw new Error(`Unknown model candidate: ${name}`);
  }

  const metadata = {
    protocol: "controlled-reliable-pager-swift-patch-v2",
    protocol_limits:
      "OpenCode has no shell or external-directory access. A fixed harness runs model-authored Swift in a network-denied sandbox with an empty HOME, then supplies public diagnostics for at most two revisions. Hidden tests are added only after the final model turn.",
    seed: args.seed,
    repeat: args.repeat,
    selected,
    fixture_sha256: sourceFixtureHash,
    hidden_test_sha256: createHash("sha256").update(fs.readFileSync(hiddenTest)).digest("hex"),
    runner_sha256: createHash("sha256")
      .update(fs.readFileSync(new URL(import.meta.url)))
      .digest("hex"),
    opencode_version: command(["opencode", "--version"], process.cwd()).trim(),
    swift_version: command(["swift", "--version"], process.cwd()).trim(),
    xcode_version: command(["xcodebuild", "-version"], process.cwd()).trim(),
    sdk_version: command(["xcrun", "--show-sdk-version"], process.cwd()).trim(),
    os_version: command(["sw_vers"], process.cwd()).trim(),
    architecture: command(["uname", "-m"], process.cwd()).trim(),
    cost_protocol:
      "Per completed request; OpenAI input context above 272k is repriced at 2x input/cache and 1.5x output.",
  };
  const globalInstructionsPath = path.join(os.homedir(), ".config", "opencode", "AGENTS.md");
  metadata.global_instructions_sha256 = fs.existsSync(globalInstructionsPath)
    ? createHash("sha256").update(fs.readFileSync(globalInstructionsPath)).digest("hex")
    : null;
  metadata.environment_sha256 = createHash("sha256").update(JSON.stringify({
    opencode: metadata.opencode_version,
    swift: metadata.swift_version,
    xcode: metadata.xcode_version,
    sdk: metadata.sdk_version,
    os: metadata.os_version,
    architecture: metadata.architecture,
  })).digest("hex");
  const results = [];
  const modelCatalogHashes = Object.fromEntries(selected.map((name) => {
    const provider = candidates[name].model.split("/", 1)[0];
    return [name, createHash("sha256")
      .update(command(["opencode", "models", provider, "--verbose"], process.cwd()))
      .digest("hex")];
  }));
  metadata.model_catalog_sha256 = modelCatalogHashes;
  writePrivateFile(
    path.join(outputDir, "metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
  );
  for (let repetition = 1; repetition <= args.repeat; repetition += 1) {
    const order = latinSquareOrder(selected, args.seed, repetition);
    for (const name of order) {
      results.push(await runTrial({
        name,
        candidate: candidates[name],
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
        modelCatalogHash: modelCatalogHashes[name],
        globalInstructionsHash: metadata.global_instructions_sha256,
        environmentHash: metadata.environment_sha256,
      }));
    }
  }
  writePrivateFile(
    path.join(outputDir, "summary.json"),
    `${JSON.stringify(results, null, 2)}\n`,
  );
  absorbAndScrubPersistedAuth(dataHome, authState);
  if (fs.existsSync(path.join(dataHome, "opencode", "auth.json"))) {
    throw new Error("Benchmark output retained a copied OpenCode auth file");
  }
}

await main();
