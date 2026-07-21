#!/usr/bin/env bun

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "setup-opencode-transaction-test-"));
const homeDir = path.join(testRoot, "home");
const configDir = path.join(homeDir, ".config", "opencode");
const stubBin = path.join(testRoot, "bin");
const miseShimBin = path.join(testRoot, "mise", "shims");
const transactionTempDir = path.join(testRoot, "transaction-tmp");
const externalTarget = path.join(testRoot, "external-target");

function writeFile(filePath, content, mode = 0o640) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, { mode });
  fs.chmodSync(filePath, mode);
}

function writeExecutable(name, content) {
  const filePath = path.join(stubBin, name);
  writeFile(filePath, content, 0o700);
}

function fingerprintTree(root) {
  const result = {};
  function visit(filePath, relativePath) {
    const metadata = fs.lstatSync(filePath);
    const mode = metadata.mode & 0o777;
    if (metadata.isSymbolicLink()) {
      result[relativePath] = { type: "symlink", mode, target: fs.readlinkSync(filePath) };
      return;
    }
    if (metadata.isDirectory()) {
      result[relativePath] = { type: "directory", mode };
      for (const name of fs.readdirSync(filePath).sort()) {
        visit(path.join(filePath, name), path.join(relativePath, name));
      }
      return;
    }
    const content = fs.readFileSync(filePath);
    result[relativePath] = {
      type: "file",
      mode,
      bytes: content.length,
      sha256: createHash("sha256").update(content).digest("hex"),
    };
  }

  if (!fs.lstatSync(root, { throwIfNoEntry: false })) return { exists: false };
  visit(root, ".");
  return { exists: true, entries: result };
}

try {
  fs.mkdirSync(stubBin, { recursive: true });
  fs.mkdirSync(miseShimBin, { recursive: true });
  fs.mkdirSync(transactionTempDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true, mode: 0o751 });
  fs.chmodSync(configDir, 0o751);
  writeFile(externalTarget, "external symlink target\n", 0o600);

  writeFile(path.join(configDir, "AGENTS.md"), "pre-run local instructions\n");
  writeFile(path.join(configDir, "opencode.json"), '{"preRun":true}\n', 0o600);
  writeFile(
    path.join(configDir, "package.json"),
    '{"dependencies":{"@opencode-ai/plugin":"1.17.20"}}\n',
    0o600,
  );
  writeFile(path.join(configDir, "plugins", "advisor.ts"), "retired plugin\n", 0o600);
  writeFile(path.join(configDir, "plugins", "user-local.js"), "unmanaged plugin\n", 0o600);
  writeFile(
    path.join(configDir, "commands", "mobile-on-call", "init.md"),
    "pre-run plugin command\n",
  );
  writeFile(
    path.join(configDir, "commands", "user-local.md"),
    "unmanaged user command\n",
  );
  writeFile(path.join(configDir, "tools", "read.ts"), "user read override\n");
  writeFile(
    path.join(configDir, "agents", "accessibility_auditor.md"),
    "pre-run agent override\n",
  );
  writeFile(path.join(configDir, "skills", "split", "SKILL.md"), "pre-run split skill\n");
  writeFile(
    path.join(configDir, "backups", "setup-opencode", "existing-backup"),
    "pre-run backup\n",
    0o600,
  );
  fs.symlinkSync(
    path.join(repoRoot, "opencode", "agents", "backend_architect.md"),
    path.join(configDir, "agents", "backend_architect.md"),
  );
  const retiredSkillPath = path.join(configDir, "skills", "legacy-generated-skill");
  const retiredSkillTarget = path.join(
    repoRoot,
    "codex",
    "skills",
    "legacy-generated-skill",
  );
  fs.symlinkSync(retiredSkillTarget, retiredSkillPath);
  fs.symlinkSync(externalTarget, path.join(configDir, "commands", "advise.md"));
  for (const name of ["luna", "sol", "sonnet", "terra"]) {
    fs.symlinkSync(
      path.join(repoRoot, "opencode", "commands", `${name}.md`),
      path.join(configDir, "commands", `${name}.md`),
    );
  }
  writeExecutable("opencode", "#!/bin/sh\nexit 0\n");
  writeExecutable("notion", String.raw`#!/bin/bash
set -eu
printf 'called\n' >> "$NOTION_CALL_LOG"
config="$OPENCODE_CONFIG_DIR"
mkdir -p "$config/commands/mobile-on-call" "$config/skills/mobile-review-pr" "$config/agents"
for skill in mobile-ios-tma-module honeycomb tuist-generated-projects; do
  mkdir -p "$config/skills/$skill"
  printf 'plugin refresh skill\n' > "$config/skills/$skill/SKILL.md"
done
printf 'plugin refresh command\n' > "$config/commands/mobile-on-call/init.md"
printf 'plugin refresh skill\n' > "$config/skills/mobile-review-pr/SKILL.md"
printf 'generated plugin agent\n' > "$config/agents/periphery-fixer.md"
`);
  writeFile(path.join(miseShimBin, "notion"), "#!/bin/sh\nexit 42\n", 0o700);
  writeExecutable("bun", String.raw`#!/bin/bash
set -eu
if [ "$1" = "-e" ]; then
  printf false
  exit 0
fi
script="$1"
shift
case "$script" in
  */merge-opencode-config.mjs)
    config="$2"
    case " $* " in
      *" --check "*) exit 0 ;;
    esac
    mkdir -p "$config/backups/setup-opencode"
    if [ -f "$config/opencode.json" ]; then
      cp "$config/opencode.json" "$config/backups/setup-opencode/stub-merge-backup"
    fi
    printf '{"mutatedByLateMerge":true}\n' > "$config/opencode.json"
    ;;
  */test-opencode-workflow-plugin.mjs)
    exit 0
    ;;
  */test-opencode-policy-resolver.mjs)
    exit 0
    ;;
  */resolve-opencode-policy.mjs)
    case " $* " in
      *" --validate "*) exit 0 ;;
      *)
        echo "unexpected policy resolver invocation: $script $*" >&2
        exit 98
        ;;
    esac
    ;;
  */validate-opencode-agents.mjs)
    exit 0
    ;;
  */normalize-opencode-notion-assets.mjs)
    config="$1"
    shift
    case " $* " in
      *" --check-refresh "*) ;;
      *" --retire-obsolete "*)
        mkdir -p "$config/backups/setup-opencode/stub-retired/plugins"
        if [ -e "$config/plugins/advisor.ts" ]; then
          mv "$config/plugins/advisor.ts" "$config/backups/setup-opencode/stub-retired/plugins/advisor.ts"
        fi
        ;;
      *" --prepare-refresh "*)
        mkdir -p "$config/.managed/claude-config/refresh-pending"
        printf 'pending\n' > "$config/.managed/claude-config/refresh-pending/manifest.json"
        rm -f "$config/commands/mobile-on-call/init.md"
        ;;
      *" --retire-unsupported-agents "*)
        rm -f "$config/agents/periphery-fixer.md"
        ;;
      *" --commit-refresh "*)
        rm -rf "$config/.managed/claude-config/refresh-pending"
        ;;
      *)
        mkdir -p "$config/.managed/claude-config"
        printf 'normalized\n' > "$config/.managed/claude-config/notion-assets.json"
        ;;
    esac
    ;;
  */validate-opencode-install.mjs)
    case " $* " in
      *" --require-installed-assets "*)
        if [ "$FAIL_LATE_VALIDATION" = "true" ]; then
      echo 'forced late validation failure' >&2
      exit 97
        fi
        ;;
    esac
    ;;
  *)
    echo "unexpected bun invocation: $script $*" >&2
    exit 98
    ;;
esac
`);

  const configBefore = fingerprintTree(configDir);
  const result = Bun.spawnSync(["bash", path.join(repoRoot, "setup-opencode.sh")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      OPENCODE_CONFIG_DIR: configDir,
      OPENCODE_SETUP_TMPDIR: transactionTempDir,
      FAIL_LATE_VALIDATION: "true",
      NOTION_CALL_LOG: path.join(testRoot, "notion-calls.log"),
      MISE_TRUSTED_CONFIG_PATHS: path.join(os.homedir(), ".config", "mise", "config.toml"),
      PATH: `${stubBin}:${process.env.PATH}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.equal(result.exitCode, 97, result.stderr.toString());
  assert.match(result.stderr.toString(), /forced late validation failure/);
  assert.match(result.stderr.toString(), /ROLLBACK OpenCode setup failed/);
  assert.deepEqual(fingerprintTree(configDir), configBefore);
  assert.deepEqual(fs.readdirSync(transactionTempDir), []);

  const success = Bun.spawnSync(["bash", path.join(repoRoot, "setup-opencode.sh")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      OPENCODE_CONFIG_DIR: configDir,
      OPENCODE_SETUP_TMPDIR: transactionTempDir,
      FAIL_LATE_VALIDATION: "false",
      NOTION_CALL_LOG: path.join(testRoot, "notion-calls.log"),
      MISE_TRUSTED_CONFIG_PATHS: path.join(os.homedir(), ".config", "mise", "config.toml"),
      PATH: `${stubBin}:${process.env.PATH}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.equal(success.exitCode, 0, success.stderr.toString());
  assert.equal(
    fs.readlinkSync(path.join(configDir, "commands", "advise.md")),
    externalTarget,
  );
  for (const name of fs.readdirSync(path.join(repoRoot, "skills"))) {
    const source = path.join(repoRoot, "skills", name);
    if (!fs.statSync(source).isDirectory() || !fs.existsSync(path.join(source, "SKILL.md"))) {
      continue;
    }
    const installed = path.join(configDir, "skills", name);
    assert.equal(fs.lstatSync(installed).isSymbolicLink(), true);
    assert.equal(fs.readlinkSync(installed), source);
  }
  assert.equal(fs.lstatSync(retiredSkillPath, { throwIfNoEntry: false }), undefined);
  const retiredSkillBackup = fs.readdirSync(
    path.join(configDir, "backups", "setup-opencode"),
  ).find((name) => name.startsWith("skills-legacy-generated-skill.bak."));
  assert.notEqual(retiredSkillBackup, undefined);
  assert.equal(
    fs.readlinkSync(
      path.join(configDir, "backups", "setup-opencode", retiredSkillBackup),
    ),
    retiredSkillTarget,
  );
  const workflowGuardPath = path.join(
    configDir,
    "plugins",
    "goal-workflow-guard.js",
  );
  const goalModePath = path.join(configDir, "plugins", "goal-mode.js");
  for (const name of fs.readdirSync(path.join(repoRoot, "opencode", "plugins"))) {
    assert.equal(
      fs.lstatSync(path.join(configDir, "plugins", name)).isSymbolicLink(),
      false,
      `${name} must be copied into the active OpenCode plugin directory`,
    );
  }
  assert.equal(
    fs.lstatSync(workflowGuardPath).isSymbolicLink(),
    false,
  );
  assert.equal(
    fs.readFileSync(workflowGuardPath, "utf8"),
    fs.readFileSync(path.join(repoRoot, "opencode", "plugins", "goal-workflow-guard.js"), "utf8"),
  );
  assert.equal(
    fs.lstatSync(goalModePath).isSymbolicLink(),
    false,
  );
  assert.equal(
    fs.readFileSync(goalModePath, "utf8"),
    fs.readFileSync(path.join(repoRoot, "opencode", "plugins", "goal-mode.js"), "utf8"),
  );
  const primitivesPath = path.join(configDir, "plugins", "kdco-primitives");
  assert.equal(fs.lstatSync(primitivesPath).isSymbolicLink(), false);
  assert.equal(
    fs.readFileSync(path.join(primitivesPath, "index.ts"), "utf8"),
    fs.readFileSync(path.join(repoRoot, "opencode", "plugins", "kdco-primitives", "index.ts"), "utf8"),
  );
  assert.equal(
    fs.readFileSync(path.join(configDir, "plugins", "user-local.js"), "utf8"),
    "unmanaged plugin\n",
  );
  for (const [directory, files] of Object.entries({
    "context-tools": ["glob.ts", "grep.ts", "ast_grep.ts", "text_read.ts"],
    "context-tools-lib": ["runtime.ts", "text-read.ts"],
  })) {
    for (const name of files) {
      assert.equal(
        fs.readFileSync(path.join(configDir, directory, name), "utf8"),
        fs.readFileSync(path.join(repoRoot, "opencode", directory, name), "utf8"),
      );
    }
  }
  for (const name of ["glob.ts", "grep.ts", "ast_grep.ts", "text_read.ts"]) {
    assert.equal(
      fs.readFileSync(path.join(configDir, "tools", name), "utf8"),
      fs.readFileSync(path.join(repoRoot, "opencode", "context-tools", name), "utf8"),
    );
  }
  assert.equal(
    fs.readFileSync(path.join(configDir, "tools", "read.ts"), "utf8"),
    "user read override\n",
  );
  assert.equal(
    fs.readFileSync(path.join(configDir, "commands", "user-local.md"), "utf8"),
    "unmanaged user command\n",
  );
  for (const name of ["luna", "sol", "sonnet", "terra"]) {
    assert.equal(
      fs.lstatSync(
        path.join(configDir, "commands", `${name}.md`),
        { throwIfNoEntry: false },
      ),
      undefined,
    );
  }
  assert.deepEqual(fs.readdirSync(transactionTempDir), []);

  const notionCallsBeforeSkip = fs.readFileSync(
    path.join(testRoot, "notion-calls.log"),
    "utf8",
  );
  const skipped = Bun.spawnSync(
    ["bash", path.join(repoRoot, "setup-opencode.sh"), "--skip-notion-cli"],
    {
      cwd: repoRoot,
      env: {
        ...process.env,
        HOME: homeDir,
        OPENCODE_CONFIG_DIR: configDir,
        OPENCODE_SETUP_TMPDIR: transactionTempDir,
        FAIL_LATE_VALIDATION: "false",
        NOTION_CALL_LOG: path.join(testRoot, "notion-calls.log"),
        MISE_TRUSTED_CONFIG_PATHS: path.join(os.homedir(), ".config", "mise", "config.toml"),
        PATH: `${stubBin}:${process.env.PATH}`,
      },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  assert.equal(skipped.exitCode, 0, skipped.stderr.toString());
  assert.equal(
    fs.readFileSync(path.join(testRoot, "notion-calls.log"), "utf8"),
    notionCallsBeforeSkip,
  );

  const shimFallback = Bun.spawnSync(["bash", path.join(repoRoot, "setup-opencode.sh")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      OPENCODE_CONFIG_DIR: configDir,
      OPENCODE_SETUP_TMPDIR: transactionTempDir,
      FAIL_LATE_VALIDATION: "false",
      NOTION_CALL_LOG: path.join(testRoot, "notion-calls.log"),
      MISE_TRUSTED_CONFIG_PATHS: path.join(os.homedir(), ".config", "mise", "config.toml"),
      PATH: `${miseShimBin}:${stubBin}:${process.env.PATH}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.equal(shimFallback.exitCode, 0, shimFallback.stderr.toString());
  assert.match(shimFallback.stderr.toString(), /Notion OpenCode plugins could not be refreshed/);
  assert.deepEqual(fs.readdirSync(transactionTempDir), []);

  console.log("OK     OpenCode setup copies managed plugins and restores late failures");
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}
