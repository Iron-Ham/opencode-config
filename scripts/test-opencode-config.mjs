#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-merge-test-"));

try {
  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify({
    permission: {
      bash: {
        "rm -rf *": "deny",
        "custom-tool *": "ask",
        "*": "allow",
      },
      read: {
        ".env": "allow",
        "*": "allow",
      },
      task: { "machine-local-agent": "allow" },
      skill: { "machine-local-skill": "deny" },
    },
    agent: {
      plan: { permission: { task: { general: "allow" } } },
      explore: { permission: { bash: "allow", edit: "allow" } },
      luna: { variant: "low", options: { reasoningEffort: "low" } },
    },
    provider: {
      custom: { models: { local: { name: "Local" } } },
      baseten: { whitelist: ["org/machine-local-model"] },
      openai: {
        models: {
          "gpt-5.6-luna-xhigh-pinned": {
            name: "unsafe override",
            options: { reasoningEffort: "low" },
          },
        },
      },
    },
    mcp: { local: { type: "local", command: ["true"] } },
    small_model: "baseten/moonshotai/Kimi-K2.7-Code",
    plugin: [
      "advisor@9.9.9",
      "opencode-dynamic-workflows@1.2.3",
      "@prevalentware/opencode-goal-plugin@0.0.1",
    ],
  }));

  const merge = Bun.spawnSync([
    "bun",
    path.join(repoRoot, "scripts", "merge-opencode-config.mjs"),
    repoRoot,
    configDir,
  ], { stdout: "pipe", stderr: "pipe" });
  assert.equal(merge.exitCode, 0, merge.stderr.toString());

  const merged = JSON.parse(
    fs.readFileSync(path.join(configDir, "opencode.json"), "utf8"),
  );
  assert.equal(Object.keys(merged.permission.bash)[0], "*");
  assert.equal(merged.permission.bash["rm -rf *"], "deny");
  assert.equal(merged.permission.bash["custom-tool *"], "ask");
  assert.equal(merged.permission.read[".env"], "deny");
  assert.deepEqual(merged.permission.task, { "machine-local-agent": "allow" });
  assert.deepEqual(merged.permission.skill, { "machine-local-skill": "deny" });
  assert.equal(merged.agent.plan.permission.task["*"], "deny");
  assert.equal(merged.agent.plan.permission.task.general, undefined);
  assert.equal(merged.agent.plan.permission["*"], "ask");
  assert.equal(merged.agent.plan.permission.advisor, "ask");
  assert.equal(merged.agent.plan.permission.create_goal, "deny");
  assert.equal(merged.agent.general.permission["*"], "ask");
  assert.equal(merged.agent.general.permission.create_goal, "deny");
  assert.equal(merged.agent.explore.permission.bash, "deny");
  assert.equal(merged.agent.explore.permission.edit, "deny");
  assert.equal(merged.agent.explore.permission["*"], "deny");
  assert.equal(merged.permission.create_goal, "deny");
  assert.equal(merged.agent.build.permission.create_goal, "allow");
  assert.equal(merged.agent.build.permission.advisor, "ask");
  assert.equal(merged.model, "openai/gpt-5.6-luna-xhigh-pinned");
  assert.equal(merged.agent.build.model, "openai/gpt-5.6-luna-xhigh-pinned");
  assert.equal(merged.agent.general.model, "openai/gpt-5.6-luna-xhigh-pinned");
  assert.equal(merged.agent.sonnet.model, "anthropic/claude-sonnet-5-default-pinned");
  assert.equal(merged.agent.sonnet.permission.create_goal, "allow");
  assert.equal(merged.agent.sonnet.permission.advisor, "ask");
  assert.equal(merged.agent.terra.model, "openai/gpt-5.6-terra-xhigh-pinned");
  assert.equal(merged.agent.terra.permission.create_goal, "allow");
  assert.equal(merged.agent.terra.permission.advisor, "ask");
  assert.equal(merged.agent.ultra.permission.advisor, "allow");
  assert.equal(merged.agent.luna.variant, undefined);
  assert.equal(merged.agent.luna.options, undefined);
  assert.equal(merged.provider.custom.models.local.name, "Local");
  assert.ok(merged.provider.baseten.whitelist.includes("org/machine-local-model"));
  assert.ok(merged.provider.baseten.whitelist.includes("zai-org/GLM-5.2"));
  assert.equal(merged.mcp.local.command[0], "true");
  assert.equal(merged.small_model, undefined);

  const lunaAlias = merged.provider.openai.models["gpt-5.6-luna-xhigh-pinned"];
  assert.notEqual(lunaAlias.name, "unsafe override");
  assert.equal(lunaAlias.options.reasoningEffort, "xhigh");
  assert.ok(Object.values(lunaAlias.variants).every((variant) => variant.disabled));
  const sonnetAlias = merged.provider.anthropic.models["claude-sonnet-5-default-pinned"];
  assert.ok(Object.values(sonnetAlias.variants).every((variant) => variant.disabled));
  const terraAlias = merged.provider.openai.models["gpt-5.6-terra-xhigh-pinned"];
  assert.equal(terraAlias.options.reasoningEffort, "xhigh");
  assert.ok(Object.values(terraAlias.variants).every((variant) => variant.disabled));
  assert.ok(merged.plugin.includes("advisor@9.9.9"));
  assert.ok(merged.plugin.includes("opencode-dynamic-workflows@1.2.3"));
  assert.ok(!merged.plugin.includes("@prevalentware/opencode-goal-plugin@0.0.1"));
  assert.ok(
    merged.plugin.some((plugin) =>
      String(plugin).startsWith("@prevalentware/opencode-goal-plugin@0.1.24")
    ),
  );
  assert.equal(fs.statSync(path.join(configDir, "opencode.json")).mode & 0o077, 0);

  const restrictiveConfigDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencode-merge-restrictive-test-"),
  );
  try {
    fs.writeFileSync(path.join(restrictiveConfigDir, "opencode.json"), JSON.stringify({
      permission: {
        bash: { "*": "deny", "git status": "allow" },
        read: "deny",
      },
    }));
    const restrictiveMerge = Bun.spawnSync([
      "bun",
      path.join(repoRoot, "scripts", "merge-opencode-config.mjs"),
      repoRoot,
      restrictiveConfigDir,
    ], { stdout: "pipe", stderr: "pipe" });
    assert.equal(
      restrictiveMerge.exitCode,
      0,
      restrictiveMerge.stderr.toString(),
    );
    const restrictive = JSON.parse(
      fs.readFileSync(path.join(restrictiveConfigDir, "opencode.json"), "utf8"),
    );
    assert.deepEqual(restrictive.permission.bash, {
      "*": "deny",
      "git status": "allow",
    });
    assert.equal(restrictive.permission.read["*"], "deny");
    assert.ok(
      !Object.values(restrictive.permission.read).includes("allow"),
      "managed read exceptions must not reopen a machine-local deny",
    );
  } finally {
    fs.rmSync(restrictiveConfigDir, { recursive: true, force: true });
  }

  console.log("OK     OpenCode config merge invariants");
} finally {
  fs.rmSync(configDir, { recursive: true, force: true });
}
