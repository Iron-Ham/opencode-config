#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omp-config-test-"));
const homeDir = path.join(testRoot, "home");
const configDir = path.join(homeDir, ".omp", "agent");
const configPath = path.join(configDir, "config.yml");
const stubBin = path.join(testRoot, "bin");
const callLog = path.join(testRoot, "omp-calls.log");
const miseLog = path.join(testRoot, "mise-calls.log");

function writeFile(filePath, content, mode = 0o600) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { mode });
  fs.chmodSync(filePath, mode);
}

try {
  const profile = Bun.YAML.parse(
    fs.readFileSync(path.join(repoRoot, "omp", "omp.defaults.yml"), "utf8"),
  );
  assert.equal(profile.modelRoleStorage, "global");
  assert.deepEqual(profile.modelRoles, {
    default: "openai/gpt-5.6-terra:xhigh",
    plan: "openai/gpt-5.6-terra:xhigh",
    smol: "openai/gpt-5.6-luna:high",
    task: "@smol",
    slow: "openai/gpt-5.6-sol:high",
    tiny: "openai/gpt-5.6-luna:low",
  });
  assert.deepEqual(profile.advisor, { enabled: false });
  assert.deepEqual(profile.task, { maxConcurrency: 10, maxRecursionDepth: 1 });
  assert.deepEqual(profile.glob, { enabled: true });
  assert.deepEqual(profile.grep, { enabled: true });
  assert.deepEqual(profile.astGrep, { enabled: true });
  assert.deepEqual(profile.tools, { xdev: true, xdevDocs: "builtins" });
  assert.doesNotMatch(JSON.stringify(profile), /api[_-]?key|token|secret|password/i);

  const readme = fs.readFileSync(path.join(repoRoot, "README.md"), "utf8");
  assert.match(readme, /pi\(\) \{/);
  assert.match(readme, /command omp "\$\{args\[@\]\}"/);
  assert.match(readme, /_run_notion_local_or_command pi "\$\{args\[@\]\}"/);
  assert.match(readme, /--approval-mode|--auto-approve|--yolo/);

  writeFile(configPath, [
    "modelRoles:",
    "  advisor: anthropic/claude-sonnet:high",
    "  vision: openai/gpt-4o:high",
    "advisor:",
    "  enabled: true",
    "unmanaged:",
    "  apiKey: do-not-log-or-replace",
    "  keep: true",
    "",
  ].join("\n"));
  fs.mkdirSync(stubBin, { recursive: true });
  writeFile(path.join(stubBin, "mise"), `#!/usr/bin/env bash
set -eu
printf '%s\\n' "$*" >> "$MISE_CALL_LOG"
if [ "$1" != exec ] || [ "$2" != bun@1.3.14 ] || [ "$3" != -- ]; then
  exit 1
fi
shift 3
exec "$@"
`, 0o700);
  writeFile(path.join(stubBin, "bun"), `#!/usr/bin/env bash
set -eu
exec "$TEST_BUN_BIN" "$@"
`, 0o700);
  writeFile(path.join(stubBin, "omp"), `#!/usr/bin/env bash
set -eu
printf '%s\n' "$*" >> "$OMP_CALL_LOG"
if [ "$1" = --version ]; then
  printf '%s\n' 'omp/17.1.2'
  exit 0
fi
if [ "$1" = config ] && [ "$2" = path ]; then
  printf '%s\n' "$STUB_AGENT_DIR"
fi
if [ "$1" = config ] && [ "$2" = get ] && [ "\${OMP_FAIL_CONFIG_GET:-}" = 1 ]; then
  exit 1
fi
`, 0o700);

  const result = Bun.spawnSync(["bash", path.join(repoRoot, "setup-omp.sh")], {
    cwd: repoRoot,
    env: {
      ...process.env,
       HOME: homeDir,
       OMP_MISE_BIN: path.join(stubBin, "mise"),
       OMP_CALL_LOG: callLog,
       MISE_CALL_LOG: miseLog,
       TEST_BUN_BIN: process.execPath,
       STUB_AGENT_DIR: configDir,
      PATH: `${stubBin}:${process.env.PATH}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.equal(result.exitCode, 0, result.stderr.toString());
  const output = `${result.stdout.toString()}${result.stderr.toString()}`;
  assert.doesNotMatch(output, /do-not-log-or-replace|apiKey/i);

  const installed = Bun.YAML.parse(fs.readFileSync(configPath, "utf8"));
  assert.equal(installed.modelRoles.advisor, undefined);
  assert.equal(installed.modelRoles.vision, "openai/gpt-4o:high");
  assert.equal(installed.advisor.enabled, false);
  assert.equal(installed.unmanaged.apiKey, "do-not-log-or-replace");
  assert.equal(installed.unmanaged.keep, true);
  assert.equal(installed.task.maxConcurrency, 10);
  assert.equal(installed.astGrep.enabled, true);
  assert.equal(installed.tools.xdev, true);
  assert.equal(installed.tools.discoveryMode, undefined);
  assert.equal(fs.statSync(configPath).mode & 0o077, 0);
  assert.equal(fs.readdirSync(path.join(configDir, "backups", "setup-omp")).length, 1);
  const calls = fs.readFileSync(callLog, "utf8");
  assert.match(calls, /config get modelRoles/);
  assert.match(fs.readFileSync(miseLog, "utf8"), /exec bun@1\.3\.14 -- omp --version/);

  const fallbackRoot = path.join(testRoot, "fallback");
  const fallbackConfig = path.join(fallbackRoot, "config.yml");
  writeFile(fallbackConfig, "unmanaged:\n  keep: true\n");
  const fallbackBin = path.join(testRoot, "fallback-bin");
  fs.mkdirSync(fallbackBin, { recursive: true });
  fs.copyFileSync(path.join(stubBin, "mise"), path.join(fallbackBin, "mise"));
  fs.copyFileSync(path.join(stubBin, "bun"), path.join(fallbackBin, "bun"));
  fs.copyFileSync(path.join(stubBin, "omp"), path.join(fallbackBin, "omp"));
  const fallback = Bun.spawnSync(["bash", path.join(repoRoot, "setup-omp.sh")], {
    cwd: repoRoot,
    env: {
      ...process.env,
       HOME: homeDir,
       OMP_MISE_BIN: path.join(fallbackBin, "mise"),
       OMP_AGENT_DIR: fallbackRoot,
       OMP_CONFIG_PATH: fallbackConfig,
       OMP_CALL_LOG: callLog,
       MISE_CALL_LOG: miseLog,
       TEST_BUN_BIN: process.execPath,
       PATH: `${fallbackBin}:${process.env.PATH}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.equal(fallback.exitCode, 0, fallback.stderr.toString());
  const fallbackInstalled = Bun.YAML.parse(fs.readFileSync(fallbackConfig, "utf8"));
  assert.equal(fallbackInstalled.unmanaged.keep, true);
  assert.equal(fallbackInstalled.modelRoles.default, "openai/gpt-5.6-terra:xhigh");

  const rollbackConfig = "unmanaged:\n  preserved: before-failure\n";
  writeFile(configPath, rollbackConfig);
  const failedUpdate = Bun.spawnSync(["bash", path.join(repoRoot, "setup-omp.sh")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      OMP_MISE_BIN: path.join(stubBin, "mise"),
      OMP_CALL_LOG: callLog,
      MISE_CALL_LOG: miseLog,
      TEST_BUN_BIN: process.execPath,
      STUB_AGENT_DIR: configDir,
      OMP_FAIL_CONFIG_GET: "1",
      PATH: `${stubBin}:${process.env.PATH}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.notEqual(failedUpdate.exitCode, 0);
  assert.equal(fs.readFileSync(configPath, "utf8"), rollbackConfig);

  const missingConfig = path.join(testRoot, "missing", "config.yml");
  const failedCreate = Bun.spawnSync(["bash", path.join(repoRoot, "setup-omp.sh")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      OMP_CONFIG_PATH: missingConfig,
      OMP_MISE_BIN: path.join(stubBin, "mise"),
      OMP_CALL_LOG: callLog,
      MISE_CALL_LOG: miseLog,
      TEST_BUN_BIN: process.execPath,
      OMP_FAIL_CONFIG_GET: "1",
      PATH: `${stubBin}:${process.env.PATH}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.notEqual(failedCreate.exitCode, 0);
  assert.equal(fs.existsSync(missingConfig), false);

  console.log("OK     OMP profile and safe installer invariants");
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}
