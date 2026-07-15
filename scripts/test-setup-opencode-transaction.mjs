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
const legacySkillsDir = path.join(homeDir, ".agents", "skills");
const stubBin = path.join(testRoot, "bin");
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
  fs.mkdirSync(transactionTempDir, { recursive: true });
  fs.mkdirSync(configDir, { recursive: true, mode: 0o751 });
  fs.chmodSync(configDir, 0o751);
  fs.mkdirSync(legacySkillsDir, { recursive: true, mode: 0o750 });
  fs.chmodSync(legacySkillsDir, 0o750);
  writeFile(externalTarget, "external symlink target\n", 0o600);

  writeFile(path.join(configDir, "AGENTS.md"), "pre-run local instructions\n");
  writeFile(path.join(configDir, "opencode.json"), '{"preRun":true}\n', 0o600);
  writeFile(
    path.join(configDir, "package.json"),
    '{"dependencies":{"@opencode-ai/plugin":"1.17.20"}}\n',
    0o600,
  );
  writeFile(path.join(configDir, "plugins", "advisor.ts"), "retired plugin\n", 0o600);
  writeFile(
    path.join(configDir, "commands", "mobile-on-call", "init.md"),
    "pre-run plugin command\n",
  );
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
  fs.symlinkSync(externalTarget, path.join(configDir, "commands", "advise.md"));
  fs.symlinkSync(
    path.join(repoRoot, "skills", "split"),
    path.join(legacySkillsDir, "split"),
  );
  writeFile(path.join(legacySkillsDir, "user-skill", "SKILL.md"), "pre-run user skill\n");
  fs.symlinkSync(externalTarget, path.join(legacySkillsDir, "external-link"));

  writeExecutable("opencode", "#!/bin/sh\nexit 0\n");
  writeExecutable("notion", String.raw`#!/bin/bash
set -eu
config="$OPENCODE_CONFIG_DIR"
mkdir -p "$config/commands/mobile-on-call" "$config/skills/mobile-review-pr" "$config/agents"
printf 'plugin refresh command\n' > "$config/commands/mobile-on-call/init.md"
printf 'plugin refresh skill\n' > "$config/skills/mobile-review-pr/SKILL.md"
printf 'generated plugin agent\n' > "$config/agents/periphery-fixer.md"
`);
  writeExecutable("bun", String.raw`#!/bin/bash
set -eu
if [ "$1" = "-e" ]; then
  printf true
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
  */validate-opencode-agents.mjs)
    case " $* " in
      *" --with-plugins "*)
        echo 'forced late validation failure' >&2
        exit 97
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
  const legacyBefore = fingerprintTree(legacySkillsDir);
  const result = Bun.spawnSync(["bash", path.join(repoRoot, "setup-opencode.sh")], {
    cwd: repoRoot,
    env: {
      ...process.env,
      HOME: homeDir,
      OPENCODE_CONFIG_DIR: configDir,
      OPENCODE_SETUP_TMPDIR: transactionTempDir,
      PATH: `${stubBin}:${process.env.PATH}`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });

  assert.equal(result.exitCode, 97, result.stderr.toString());
  assert.match(result.stderr.toString(), /forced late validation failure/);
  assert.match(result.stderr.toString(), /ROLLBACK OpenCode setup failed/);
  assert.deepEqual(fingerprintTree(configDir), configBefore);
  assert.deepEqual(fingerprintTree(legacySkillsDir), legacyBefore);
  assert.deepEqual(fs.readdirSync(transactionTempDir), []);

  console.log("OK     OpenCode setup restores both active trees after late failure");
} finally {
  fs.rmSync(testRoot, { recursive: true, force: true });
}
