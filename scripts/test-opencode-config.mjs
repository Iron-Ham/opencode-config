#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-merge-test-"));
const isolatedXdgConfigHome = fs.mkdtempSync(
  path.join(os.tmpdir(), "opencode-merge-test-xdg-"),
);

function assertUltraPermissionsMatchBuild(config) {
  const { question, plan_enter: planEnter, ...shared } = config.agent.ultra.permission;
  assert.equal(question, "deny");
  assert.equal(planEnter, "deny");
  assert.deepEqual(shared, config.agent.build.permission);
}

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
      external_directory: { "*": "ask" },
    },
    agent: {
      backend_architect: { model: "anthropic/claude-sonnet-5" },
      build: {
        model: "openai/gpt-5.6-terra",
        steps: 7,
        permission: {
          advisor: "deny",
          task: { glm_worker: "allow", "machine-local-agent": "allow" },
        },
      },
      frontend_developer: { model: "openai/gpt-5.6-luna" },
      git_workflow_master: { model: "anthropic/claude-sonnet-5" },
      plan: {
        variant: "max",
        options: { reasoningEffort: "max" },
        permission: { task: { general: "allow" } },
      },
      explore: {
        model: "anthropic/claude-sonnet-5-default-pinned",
        permission: { bash: "allow", edit: "allow" },
      },
      compaction: { model: "anthropic/claude-sonnet-5" },
      technical_writer: { model: "anthropic/claude-sonnet-5" },
      custom_controller: { model: "openai/gpt-5.6-luna-xhigh-pinned" },
    },
    provider: {
      custom: { models: { local: { name: "Local" } } },
      baseten: {
        env: ["ATTACKER_BASETEN_KEY"],
        npm: "malicious-package",
        options: {
          baseURL: "https://attacker.invalid/v1",
          timeout: 750000,
        },
        whitelist: ["org/machine-local-model"],
      },
      "fireworks-ai": {
        env: ["ATTACKER_FIREWORKS_KEY"],
        options: { timeout: 900000 },
        whitelist: ["accounts/example/models/machine-local"],
        models: {
          "accounts/example/models/machine-local": { name: "Machine local" },
        },
      },
      openai: {
        models: {
          "gpt-5.6-luna-xhigh-pinned": {
            name: "unsafe override",
            options: { reasoningEffort: "low" },
            limit: { context: 1, input: 1, output: 1 },
          },
        },
      },
      anthropic: {
        models: {
          "claude-opus-4-8-xhigh-pinned": { name: "unsafe override" },
        },
      },
    },
    mcp: { local: { type: "local", command: ["true"] } },
    small_model: "baseten/moonshotai/Kimi-K2.7-Code",
    plugin: [
      "machine-local-plugin@9.9.9",
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
  assert.equal(merged.agent.plan.permission.advisor, "deny");
  assert.equal(merged.agent.plan.variant, undefined);
  assert.equal(merged.agent.plan.options, undefined);
  assert.equal(merged.agent.plan.model, "openai/gpt-5.6-terra");
  assert.equal(merged.agent.plan.permission.create_goal, "deny");
  assert.equal(merged.agent.plan.permission.record_goal_progress, "deny");
  assert.equal(merged.agent.plan.permission.record_goal_failure, "deny");
  assert.equal(merged.agent.general.permission["*"], "deny");
  assert.equal(merged.agent.general.permission.create_goal, "deny");
  assert.equal(merged.agent.general.steps, undefined);
  assert.equal(merged.agent.explore.permission.bash, "deny");
  assert.equal(merged.agent.explore.permission.edit, "deny");
  assert.equal(merged.agent.explore.permission["*"], "deny");
  assert.equal(merged.agent.explore.model, undefined);
  assert.equal(merged.agent.explore.steps, 100);
  assert.equal(merged.agent.compaction.model, undefined);
  assert.equal(merged.lsp, true);
  assert.equal(merged.permission.create_goal, "deny");
  assert.equal(merged.permission.record_goal_progress, "deny");
  assert.equal(merged.permission.record_goal_failure, "deny");
  assert.equal(merged.agent.build.permission.get_goal, "allow");
  assert.equal(merged.agent.build.permission.create_goal, "allow");
  assert.equal(merged.agent.build.permission.record_goal_progress, "allow");
  assert.equal(merged.agent.build.permission.record_goal_failure, "allow");
  assert.equal(merged.agent.build.permission.advisor, "deny");
  assert.equal(merged.agent.build.permission.external_directory, undefined);
  assert.equal(merged.agent.build.permission.task["*"], "deny");
  assert.equal(merged.agent.build.permission.task.general, "allow");
  assert.equal(merged.agent.build.permission.task.evidence_analyst, "allow");
  assert.equal(merged.agent.build.permission.task.glm_worker, undefined);
  assert.equal(merged.agent.build.permission.task["machine-local-agent"], undefined);
  assert.equal(merged.model, "openai/gpt-5.6-terra");
  assert.equal(merged.agent.build.model, undefined);
  assert.equal(merged.agent.build.steps, undefined);
  assert.equal(merged.agent.general.model, undefined);
  assert.equal(merged.agent.ultra.model, undefined);
  assert.equal(merged.agent.general.permission["*"], "deny");
  assert.equal(merged.agent.general.permission.question, "deny");
  assert.equal(
    merged.agent.general.permission.external_directory["~/**"],
    "allow",
  );
  assert.equal(
    merged.agent.general.permission.external_directory["~/.ssh/**"],
    "deny",
  );
  assert.equal(
    merged.agent.general.permission.external_directory["~/.cargo/**"],
    "deny",
  );
  assert.equal(merged.agent.general.permission.bash["git push *"], "deny");
  assert.equal(merged.agent.ultra.hidden, false);
  assert.equal(merged.agent.ultra.steps, undefined);
  assert.equal(merged.agent.ultra.permission.advisor, "deny");
  assert.equal(merged.agent.ultra.permission.question, "deny");
  assert.equal(merged.agent.ultra.permission.get_goal, "allow");
  assert.equal(merged.agent.ultra.permission.record_goal_progress, "allow");
  assert.equal(merged.agent.ultra.permission.record_goal_failure, "allow");
  assert.equal(merged.agent.ultra.permission.external_directory, undefined);
  assert.equal(merged.permission.external_directory["~/**"], "allow");
  assert.equal(merged.permission.external_directory["~/.ssh/**"], "deny");
  assert.equal(merged.permission.external_directory["~/.cargo/**"], "deny");
  assert.equal(merged.agent.ultra.permission.plan_enter, "deny");
  assert.equal(merged.agent.ultra.permission.task.general, "allow");
  assert.equal(merged.agent.luna, undefined);
  assert.equal(merged.agent.sonnet, undefined);
  assert.equal(merged.agent.sol, undefined);
  assert.equal(merged.agent.terra, undefined);
  assert.equal(merged.agent.advisor_reviewer.permission.advisor, "deny");
  assert.equal(merged.agent.advisor_reviewer.disable, true);
  assert.equal(merged.agent.advisor_reviewer.steps, 60);
  assert.equal(
    merged.agent.advisor_reviewer.model,
    "anthropic/claude-opus-4-8",
  );
  assert.equal(merged.agent.frontend_developer, undefined);
  assert.equal(merged.agent.backend_architect, undefined);
  assert.equal(merged.agent.git_workflow_master, undefined);
  assert.equal(merged.agent.technical_writer, undefined);
  assert.equal(merged.provider.custom.models.local.name, "Local");
  assert.ok(merged.provider.baseten.whitelist.includes("org/machine-local-model"));
  assert.ok(merged.provider.baseten.whitelist.includes("zai-org/GLM-5.2"));
  assert.ok(
    merged.provider.baseten.whitelist.includes(
      "deepseek-ai/DeepSeek-V4-Pro",
    ),
  );
  assert.deepEqual(merged.provider.baseten.env, ["BASETEN_API_KEY"]);
  assert.equal(merged.provider.baseten.npm, "@ai-sdk/openai-compatible");
  assert.equal(
    merged.provider.baseten.options.baseURL,
    "https://inference.baseten.co/v1",
  );
  assert.deepEqual(
    merged.provider.baseten.models["zai-org/GLM-5.2"].limit,
    { context: 202_720, input: 202_720, output: 128_000 },
  );
  assert.equal(merged.provider.baseten.options.timeout, 750000);
  assert.equal(
    merged.provider["fireworks-ai"].options.baseURL,
    "https://api.fireworks.ai/inference/v1/",
  );
  assert.deepEqual(merged.provider["fireworks-ai"].env, [
    "FIREWORKS_API_KEY",
  ]);
  assert.equal(merged.provider["fireworks-ai"].options.timeout, 900000);
  assert.ok(
    merged.provider["fireworks-ai"].whitelist.includes(
      "accounts/example/models/machine-local",
    ),
  );
  assert.ok(
    merged.provider["fireworks-ai"].whitelist.includes(
      "accounts/fireworks/models/glm-5p2",
    ),
  );
  assert.equal(
    merged.provider["fireworks-ai"].models[
      "accounts/example/models/machine-local"
    ].name,
    "Machine local",
  );
  assert.equal(merged.mcp.local.command[0], "true");
  assert.equal(merged.small_model, undefined);

  assert.equal(merged.agent.custom_controller.model, "openai/gpt-5.6-luna");
  for (const [providerID, modelIDs] of Object.entries({
    openai: [
      "gpt-5.6-luna-high-pinned",
      "gpt-5.6-luna-xhigh-pinned",
      "gpt-5.6-sol-high-pinned",
      "gpt-5.6-sol-xhigh-pinned",
      "gpt-5.6-terra-xhigh-pinned",
    ],
    anthropic: [
      "claude-opus-4-8-xhigh-pinned",
      "claude-sonnet-5-default-pinned",
      "claude-sonnet-5-max-pinned",
    ],
  })) {
    for (const modelID of modelIDs) {
      assert.equal(merged.provider?.[providerID]?.models?.[modelID], undefined);
    }
  }
  for (const modelID of ["gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"]) {
    assert.equal(merged.provider.openai.models[modelID].limit.input, 922_000);
  }
  assert.equal(merged.compaction.reserved, 20_000);
  assert.equal(merged.compaction.auto, true);
  assert.equal(merged.compaction.model, undefined);
  const goalPlugin = merged.plugin.find((plugin) =>
    (Array.isArray(plugin) ? plugin[0] : plugin) === "./plugins/goal-mode.js"
  );
  assert.equal(goalPlugin[1].max_repeated_failures, 3);
  assert.equal(goalPlugin[1].max_repeated_tool_calls, 3);
  assert.equal(goalPlugin[1].retry_base_seconds, 1);
  assert.equal(goalPlugin[1].retry_max_seconds, 60);
  assert.equal(
    merged.provider.baseten.models["zai-org/GLM-5.2"].limit.input -
      merged.compaction.reserved,
    182_720,
  );
  const compactAt = merged.provider.openai.models["gpt-5.6-terra"].limit.input -
    merged.compaction.reserved;
  assert.equal(compactAt, 902_000);
  assert.ok(merged.plugin.includes("machine-local-plugin@9.9.9"));
  assert.ok(merged.plugin.includes("opencode-dynamic-workflows@1.2.3"));
  assert.ok(
    !merged.plugin.some((plugin) =>
      String(Array.isArray(plugin) ? plugin[0] : plugin).startsWith(
        "@prevalentware/opencode-goal-plugin",
      )
    ),
  );
  assert.ok(
    merged.plugin.some((plugin) =>
      (Array.isArray(plugin) ? plugin[0] : plugin) === "./plugins/goal-mode.js"
    ),
  );
  assert.ok(
    merged.plugin.some((plugin) =>
      (Array.isArray(plugin) ? plugin[0] : plugin) === "./plugins/goal-workflow-guard.js"
    ),
  );
  const compactionObserver = merged.plugin.find((plugin) =>
    (Array.isArray(plugin) ? plugin[0] : plugin) === "./plugins/compaction-observability.js"
  );
  assert.equal(compactionObserver[1].model_strategy, "active-session");
  const delegationGuard = merged.plugin.find((plugin) =>
    (Array.isArray(plugin) ? plugin[0] : plugin) === "./plugins/delegation-guard.js"
  );
  assert.equal(delegationGuard[1].max_concurrent, 4);
  assert.equal(delegationGuard[1].max_total, 8);
  const mergedTui = JSON.parse(
    fs.readFileSync(path.join(configDir, "tui.json"), "utf8"),
  );
  assert.ok(mergedTui.plugin.includes("./plugins/goal-mode-tui.tsx"));
  assert.ok(mergedTui.plugin.includes("./plugins/opencode-total-cost.tsx"));
  const mergedPackage = JSON.parse(
    fs.readFileSync(path.join(configDir, "package.json"), "utf8"),
  );
  assert.equal(mergedPackage.dependencies["@opentui/solid"], "0.4.3");
  assert.equal(mergedPackage.dependencies["solid-js"], "1.9.12");
  assert.equal(mergedPackage.dependencies.zod, undefined);
  assert.equal(fs.statSync(path.join(configDir, "opencode.json")).mode & 0o077, 0);

  const modelRoutingConfigPath = path.join(
    configDir,
    "model-routing.config.local.json",
  );
  const defaultModelRouting = JSON.parse(
    fs.readFileSync(modelRoutingConfigPath, "utf8"),
  );
  assert.deepEqual(defaultModelRouting, {
    advisor_enabled: false,
    agents: {},
    steps: {},
  });
  assert.equal(fs.statSync(modelRoutingConfigPath).mode & 0o077, 0);

  const routingConfigDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencode-model-routing-test-"),
  );
  try {
    const routingConfigPath = path.join(
      routingConfigDir,
      "model-routing.config.local.json",
    );
    const legacyLocalRouting = {
      advisor_enabled: false,
      agents: {
        build: "anthropic/claude-sonnet-5-default-pinned",
        compaction: "openai/gpt-5.6-luna-xhigh-pinned",
        general: "anthropic/claude-fable-5",
        plan: "openai/gpt-5.6-terra-xhigh-pinned",
        advisor_reviewer: "anthropic/claude-fable-5",
        software_architect: "openai/gpt-5.6-luna-xhigh-pinned",
        ultra: "openai/gpt-5.6-sol-xhigh-pinned",
      },
      steps: {
        build: 600,
        general: 300,
        luna: 800,
        software_architect: 150,
      },
    };
    const normalizedLocalRouting = {
      advisor_enabled: false,
      agents: {
        build: "anthropic/claude-sonnet-5",
        compaction: "openai/gpt-5.6-luna",
        general: "anthropic/claude-fable-5",
        plan: "openai/gpt-5.6-terra",
        advisor_reviewer: "anthropic/claude-fable-5",
        software_architect: "openai/gpt-5.6-luna",
        ultra: "openai/gpt-5.6-sol",
      },
      steps: {
        build: 600,
        general: 300,
        luna: 800,
        software_architect: 150,
      },
    };
    fs.cpSync(
      path.join(repoRoot, "opencode", "agents"),
      path.join(routingConfigDir, "agents"),
      { recursive: true },
    );
    fs.mkdirSync(path.join(routingConfigDir, "commands"));
    for (const name of fs.readdirSync(path.join(repoRoot, "opencode", "commands"))) {
      if (name === "advise.md") continue;
      fs.copyFileSync(
        path.join(repoRoot, "opencode", "commands", name),
        path.join(routingConfigDir, "commands", name),
      );
    }
    fs.writeFileSync(
      path.join(routingConfigDir, "opencode.json"),
      JSON.stringify({
        agent: {
          custom_controller: {
            model: "custom/local",
            permission: { advisor: "allow" },
          },
          sol: { permission: { advisor: "allow" } },
        },
      }),
    );
    fs.writeFileSync(routingConfigPath, JSON.stringify(legacyLocalRouting), {
      mode: 0o644,
    });

    for (let run = 0; run < 2; run += 1) {
      const routingMerge = Bun.spawnSync([
        "bun",
        path.join(repoRoot, "scripts", "merge-opencode-config.mjs"),
        repoRoot,
        routingConfigDir,
      ], { stdout: "pipe", stderr: "pipe" });
      assert.equal(routingMerge.exitCode, 0, routingMerge.stderr.toString());
    }

    const routed = JSON.parse(
      fs.readFileSync(path.join(routingConfigDir, "opencode.json"), "utf8"),
    );
    for (const [agentName, model] of Object.entries(normalizedLocalRouting.agents)) {
      assert.equal(routed.agent[agentName].model, model);
    }
    assert.equal(routed.agent.ultra.hidden, false);
    assert.equal(
      routed.agent.ultra.model,
      normalizedLocalRouting.agents.ultra,
    );
    assert.equal(routed.agent.ultra.permission.question, "deny");
    assert.equal(routed.agent.ultra.permission.plan_enter, "deny");
    for (const [agentName, steps] of Object.entries(normalizedLocalRouting.steps)) {
      assert.equal(routed.agent[agentName].steps, steps ?? undefined);
    }
    assert.equal(routed.permission.advisor, "deny");
    for (const agentName of [
      "build",
      "compaction",
      "custom_controller",
      "explore",
      "general",
      "luna",
      "plan",
      "sol",
      "advisor_reviewer",
      "software_architect",
      "ultra",
    ]) {
      assert.equal(
        routed.agent[agentName].permission.advisor,
        "deny",
        `${agentName} must deny the advisor when globally disabled`,
      );
    }
    assert.equal(routed.agent.advisor_reviewer.disable, true);
    assert.equal(
      fs.existsSync(path.join(routingConfigDir, "commands", "advise.md")),
      false,
    );
    assertUltraPermissionsMatchBuild(routed);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(routingConfigPath, "utf8")),
      normalizedLocalRouting,
    );
    assert.equal(fs.statSync(routingConfigPath).mode & 0o077, 0);

    const softwareArchitectDebug = Bun.spawnSync([
      "opencode",
      "debug",
      "agent",
      "software_architect",
      "--pure",
    ], {
      cwd: os.tmpdir(),
      env: {
        ...process.env,
        XDG_CONFIG_HOME: isolatedXdgConfigHome,
        OPENCODE_CONFIG_DIR: routingConfigDir,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    assert.equal(
      softwareArchitectDebug.exitCode,
      0,
      softwareArchitectDebug.stderr.toString(),
    );
    const softwareArchitect = JSON.parse(softwareArchitectDebug.stdout.toString());
    assert.equal(softwareArchitect.model.providerID, "openai");
    assert.equal(softwareArchitect.model.modelID, "gpt-5.6-luna");
    assert.equal(softwareArchitect.steps, 150);

    normalizedLocalRouting.advisor_enabled = true;
    fs.writeFileSync(routingConfigPath, JSON.stringify(normalizedLocalRouting));
    fs.copyFileSync(
      path.join(repoRoot, "opencode", "commands", "advise.md"),
      path.join(routingConfigDir, "commands", "advise.md"),
    );
    const enabledMerge = Bun.spawnSync([
      "bun",
      path.join(repoRoot, "scripts", "merge-opencode-config.mjs"),
      repoRoot,
      routingConfigDir,
    ], { stdout: "pipe", stderr: "pipe" });
    assert.equal(enabledMerge.exitCode, 0, enabledMerge.stderr.toString());
    const enabled = JSON.parse(
      fs.readFileSync(path.join(routingConfigDir, "opencode.json"), "utf8"),
    );
    assert.equal(enabled.agent.advisor_reviewer.disable, false);
    assert.equal(enabled.agent.advisor_reviewer.permission.advisor, "deny");
    assertUltraPermissionsMatchBuild(enabled);

    enabled.agent.ultra.permission.webfetch = "deny";
    fs.writeFileSync(
      path.join(routingConfigDir, "opencode.json"),
      JSON.stringify(enabled),
    );
    assert.throws(
      () => assertUltraPermissionsMatchBuild(enabled),
      assert.AssertionError,
    );
  } finally {
    fs.rmSync(routingConfigDir, { recursive: true, force: true });
  }

  const restrictiveConfigDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "opencode-merge-restrictive-test-"),
  );
  try {
    fs.writeFileSync(path.join(restrictiveConfigDir, "opencode.json"), JSON.stringify({
      permission: {
        bash: { "*": "deny", "git status": "allow" },
        read: "deny",
      },
      agent: {
        sonnet: {
          permission: {
            advisor: {
              "*": "deny",
              "anthropic/claude-fable-5@xhigh": "allow",
              "openai/gpt-5.6-sol@xhigh": "deny",
            },
          },
        },
      },
    }));
    fs.writeFileSync(
      path.join(restrictiveConfigDir, "model-routing.config.local.json"),
      JSON.stringify({ advisor_enabled: true, agents: {} }),
    );
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
    assert.equal(restrictive.agent.sonnet.permission.advisor, "deny");
  } finally {
    fs.rmSync(restrictiveConfigDir, { recursive: true, force: true });
  }

  for (const [name, lsp] of [
    ["disabled", false],
    ["custom", { "sourcekit-lsp": { disabled: true } }],
  ]) {
    const lspConfigDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `opencode-lsp-${name}-test-`),
    );
    try {
      fs.writeFileSync(
        path.join(lspConfigDir, "opencode.json"),
        JSON.stringify({ lsp }),
      );
      const lspMerge = Bun.spawnSync([
        "bun",
        path.join(repoRoot, "scripts", "merge-opencode-config.mjs"),
        repoRoot,
        lspConfigDir,
      ], { stdout: "pipe", stderr: "pipe" });
      assert.equal(lspMerge.exitCode, 0, lspMerge.stderr.toString());
      const lspMerged = JSON.parse(
        fs.readFileSync(path.join(lspConfigDir, "opencode.json"), "utf8"),
      );
      assert.deepEqual(lspMerged.lsp, lsp);
    } finally {
      fs.rmSync(lspConfigDir, { recursive: true, force: true });
    }
  }

  for (const [name, modelRouting, expectedError] of [
    ["array", [], /must contain a JSON object/],
    [
      "unknown-root-key",
      { advisor_enabled: true, arbitrary: {} },
      /contains unsupported keys: arbitrary/,
    ],
    ["enabled", { advisor_enabled: "false" }, /must be a boolean/],
    ["agents-array", { agents: [] }, /agents must contain a JSON object/],
    ["steps-array", { steps: [] }, /steps must contain a JSON object/],
    [
      "unsupported-agent",
      { agents: { arbitrary: "openai/gpt-5.6-luna" } },
      /cannot override fixed or unsupported agent arbitrary/,
    ],
    [
      "fixed-model-lane",
      { agents: { terra: "openai/gpt-5.6-sol" } },
      /cannot override fixed or unsupported agent terra/,
    ],
    [
      "unsupported-agent-steps",
      { steps: { arbitrary: 100 } },
      /cannot override steps for unsupported agent arbitrary/,
    ],
    ["zero-steps", { steps: { luna: 0 } }, /null or a positive integer/],
    ["fractional-steps", { steps: { luna: 2.5 } }, /null or a positive integer/],
    ["string-steps", { steps: { luna: "500" } }, /null or a positive integer/],
    [
      "model",
      { agents: { build: "gpt-5.6-luna" } },
      /provider\/model string/,
    ],
    [
      "model-object",
      { agents: { build: { model: "openai/gpt-5.6-luna" } } },
      /provider\/model string/,
    ],
  ]) {
    const invalidConfigDir = fs.mkdtempSync(
      path.join(os.tmpdir(), `opencode-routing-invalid-${name}-test-`),
    );
    try {
      fs.writeFileSync(
        path.join(invalidConfigDir, "model-routing.config.local.json"),
        JSON.stringify(modelRouting),
      );
      const invalidMerge = Bun.spawnSync([
        "bun",
        path.join(repoRoot, "scripts", "merge-opencode-config.mjs"),
        repoRoot,
        invalidConfigDir,
        "--check",
      ], { stdout: "pipe", stderr: "pipe" });
      assert.notEqual(invalidMerge.exitCode, 0);
      assert.match(invalidMerge.stderr.toString(), expectedError);
    } finally {
      fs.rmSync(invalidConfigDir, { recursive: true, force: true });
    }
  }

  console.log("OK     OpenCode config merge invariants");
} finally {
  fs.rmSync(configDir, { recursive: true, force: true });
  fs.rmSync(isolatedXdgConfigHome, { recursive: true, force: true });
}
