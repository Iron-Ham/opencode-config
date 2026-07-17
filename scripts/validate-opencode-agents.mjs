#!/usr/bin/env bun

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";

const repoRoot = path.resolve(process.argv[2]);
const configDir = path.resolve(process.argv[3]);
const withPlugins = process.argv.includes("--with-plugins");
const sshCredentialPattern = path.join(os.homedir(), ".ssh", "**");
const isolatedXdgConfigHome = fs.mkdtempSync(
  path.join(os.tmpdir(), "opencode-agent-validation-xdg-"),
);
process.on("exit", () => {
  fs.rmSync(isolatedXdgConfigHome, { recursive: true, force: true });
});

function fail(message) {
  throw new Error(`OpenCode agent validation failed: ${message}`);
}

function debugAgent(name, plugins = false) {
  const command = ["opencode", "debug", "agent", name];
  if (!plugins) command.push("--pure");
  const result = Bun.spawnSync(command, {
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      XDG_CONFIG_HOME: isolatedXdgConfigHome,
      OPENCODE_CONFIG_DIR: configDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    fail(`${name} could not be resolved: ${result.stderr.toString().trim()}`);
  }
  try {
    return JSON.parse(result.stdout.toString());
  } catch (error) {
    fail(`${name} returned invalid debug JSON: ${error.message}`);
  }
}

function debugConfig(plugins = false) {
  const command = ["opencode", "debug", "config"];
  if (!plugins) command.push("--pure");
  const result = Bun.spawnSync(command, {
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      XDG_CONFIG_HOME: isolatedXdgConfigHome,
      OPENCODE_CONFIG_DIR: configDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    fail(`resolved config could not be loaded: ${result.stderr.toString().trim()}`);
  }
  try {
    return JSON.parse(result.stdout.toString());
  } catch (error) {
    fail(`resolved config returned invalid debug JSON: ${error.message}`);
  }
}

function finalPermission(agent, permission, pattern = "*") {
  const matchingRules = (agent.permission ?? []).filter(
    (rule) =>
      (rule.pattern === "*" || rule.pattern === pattern) &&
      rule.permission === permission,
  );
  const rules = matchingRules.length > 0
    ? matchingRules
    : (agent.permission ?? []).filter(
      (rule) =>
        (rule.pattern === "*" || rule.pattern === pattern) &&
        rule.permission === "*",
    );
  let action;
  for (const rule of rules) {
    action = rule.action;
  }
  return action;
}

function normalizedPermissions(agent, ignoredPermissions = new Set()) {
  const finalRules = new Map();
  for (const rule of agent.permission ?? []) {
    if (ignoredPermissions.has(rule.permission)) continue;
    const pattern = rule.pattern ?? "*";
    finalRules.set(`${rule.permission}\0${pattern}`, {
      permission: rule.permission,
      pattern,
      action: rule.action,
    });
  }
  return [...finalRules.values()].sort((left, right) =>
    left.permission.localeCompare(right.permission) ||
    left.pattern.localeCompare(right.pattern)
  );
}

const config = JSON.parse(
  fs.readFileSync(path.join(configDir, "opencode.json"), "utf8"),
);
const managedDefaults = JSON.parse(
  fs.readFileSync(
    path.join(repoRoot, "opencode", "opencode.defaults.json"),
    "utf8",
  ),
);
const modelRoutingPath = path.join(configDir, "model-routing.config.local.json");
const modelRouting = fs.existsSync(modelRoutingPath)
  ? JSON.parse(fs.readFileSync(modelRoutingPath, "utf8"))
  : { advisor_enabled: true, agents: {}, steps: {} };
const retiredManagedAgentNames = new Set([
  "backend_architect",
  "evidence_collector",
  "frontend_developer",
  "git_workflow_master",
  "periphery-fixer",
  "sol_reviewer",
  "technical_writer",
]);
for (const name of retiredManagedAgentNames) {
  if (config.agent?.[name] !== undefined) {
    fail(`retired managed agent ${name} remains in opencode.json`);
  }
  if (fs.lstatSync(path.join(configDir, "agents", `${name}.md`), { throwIfNoEntry: false })) {
    fail(`retired managed agent ${name} remains installed`);
  }
}
const managedAgentNames = fs.readdirSync(path.join(repoRoot, "opencode", "agents"))
  .filter((name) => name.endsWith(".md"))
  .map((name) => path.basename(name, ".md"));
const disabledAgentNames = new Set(
  Object.entries(config.agent ?? {})
    .filter(([, value]) => value?.disable === true)
    .map(([name]) => name),
);
const agentNames = [...new Set([
  "build",
  "plan",
  "general",
  "explore",
  "compaction",
  "ultra",
  ...managedAgentNames,
])].filter((name) => !disabledAgentNames.has(name)).sort();
const agents = Object.fromEntries(agentNames.map((name) => [name, debugAgent(name)]));
const resolvedConfig = debugConfig();
const inheritedModelAgents = [
  "accessibility_auditor",
  "code_reviewer",
  "database_optimizer",
  "evidence_analyst",
  "explore",
  "general",
  "security_engineer",
  "software_architect",
  "ultra",
];
const inheritedModelAgentNames = new Set(inheritedModelAgents);

const {
  question: managedUltraQuestion,
  plan_enter: managedUltraPlanEnter,
  ...managedUltraSharedPermissions
} = managedDefaults.agent.ultra.permission;
if (managedUltraQuestion !== "deny" || managedUltraPlanEnter !== "deny") {
  fail("the managed Ultra profile must explicitly deny questions and Plan entry");
}
if (!isDeepStrictEqual(
  managedUltraSharedPermissions,
  managedDefaults.agent.build.permission,
)) {
  fail("the managed Ultra permissions must match Build except for unattended-mode denials");
}

if (config.agent?.compaction?.model === "anthropic/claude-sonnet-5") {
  fail("the retired fixed Sonnet compaction override is still configured");
}
if (config.agent?.plan?.variant !== undefined || config.agent?.plan?.options !== undefined) {
  fail("plan must not retain stale variant or options overrides");
}

for (const [name, agent] of Object.entries(agents)) {
  if (name === "compaction" && !modelRouting.agents?.compaction) continue;
  if (inheritedModelAgentNames.has(name) && !modelRouting.agents?.[name]) {
    if (agent.model !== undefined) {
      fail(`${name} must not resolve a fixed model by default`);
    }
    continue;
  }
  if (!agent.model?.providerID || !agent.model?.modelID) {
    fail(`${name} has no resolved model`);
  }
}
for (const [name, agent] of Object.entries(agents)) {
  const configuredSteps = config.agent?.[name]?.steps;
  if (configuredSteps === undefined) {
    if (agent.steps !== undefined) {
      fail(`${name} must not have a managed step cap`);
    }
  } else if (agent.steps !== configuredSteps) {
    fail(`${name} must use the machine-local ${configuredSteps}-step cap`);
  }
}
for (const [name, agent] of Object.entries(agents)) {
  const action = finalPermission(agent, "advisor");
  if (action !== "deny") {
    fail(`${name} must deny the external advisor tool`);
  }
}
for (const [name, agent] of Object.entries(agents)) {
  if (finalPermission(agent, "external_directory") !== "allow") {
    const rules = (agent.permission ?? []).filter(
      (rule) => rule.permission === "external_directory",
    );
    fail(
      `${name} must inherit the shared external-directory permission: ${JSON.stringify(rules)}`,
    );
  }
  if (finalPermission(agent, "external_directory", sshCredentialPattern) !== "deny") {
    fail(`${name} must deny external SSH credential files`);
  }
}
const goalControllers = new Set(["build", "ultra"]);
const goalMutationTools = [
  "create_goal",
  "set_goal",
  "update_goal_objective",
  "update_goal",
  "update_goal_status",
  "clear_goal",
];
for (const [name, agent] of Object.entries(agents)) {
  const expected = goalControllers.has(name) ? "allow" : "deny";
  for (const permission of goalMutationTools) {
    if (finalPermission(agent, permission) !== expected) {
      fail(`${name} must ${expected} ${permission}`);
    }
  }
}

const reviewedTaskTargets = new Set([
  "accessibility_auditor",
  "code_reviewer",
  "database_optimizer",
  "evidence_analyst",
  "explore",
  "security_engineer",
  "software_architect",
]);
for (const name of goalControllers) {
  const controller = agents[name];
  if (finalPermission(controller, "task", "*") !== "deny") {
    fail(`${name} must deny Task targets by default`);
  }
  for (const target of reviewedTaskTargets) {
    const expected = "allow";
    if (finalPermission(controller, "task", target) !== expected) {
      fail(`${name} must ${expected} reviewed Task target ${target}`);
    }
  }
  const expectedGeneral = new Set(["build", "ultra"]).has(name) ? "allow" : "deny";
  if (finalPermission(controller, "task", "general") !== expectedGeneral) {
    fail(`${name} must ${expectedGeneral} writable general delegation`);
  }
  for (const target of ["advisor_reviewer", "glm_worker", "kimi_reader"]) {
    if (finalPermission(controller, "task", target) !== "deny") {
      fail(`${name} must deny automatic Task delegation to ${target}`);
    }
  }
}

const ultra = agents.ultra;
if (ultra.mode !== "primary" || ultra.hidden !== false) {
  fail("ultra must remain a visible primary used by /ultra");
}
for (const permission of ["question", "plan_enter"]) {
  if (finalPermission(ultra, permission) !== "deny") {
    fail(`ultra must deny ${permission} for unattended execution`);
  }
}
if (ultra.tools?.question === true) {
  fail("ultra must not expose the interactive question tool");
}
const unattendedPermissionDifferences = new Set(["question", "plan_enter"]);
if (!isDeepStrictEqual(
  normalizedPermissions(agents.build, unattendedPermissionDifferences),
  normalizedPermissions(ultra, unattendedPermissionDifferences),
)) {
  fail("resolved Ultra permissions must match Build except for unattended-mode denials");
}

const ultraCommandSource = fs.readFileSync(
  path.join(repoRoot, "opencode", "commands", "ultra.md"),
  "utf8",
);
if (!ultraCommandSource.startsWith("---\n") || !ultraCommandSource.includes("\nagent: ultra\n")) {
  fail("/ultra must target the visible Ultra execution profile");
}
const resolvedUltraCommand = resolvedConfig.command?.ultra;
if (!resolvedUltraCommand || resolvedUltraCommand.agent !== "ultra") {
  fail("/ultra must resolve to the visible Ultra execution profile");
}
if (resolvedUltraCommand.model !== undefined || resolvedUltraCommand.subtask === true) {
  fail("/ultra must run as a primary and inherit the Ultra profile model");
}

const experimentalCommands = {
  glm: {
    agent: "glm_worker",
    model: "baseten/zai-org/GLM-5.2",
  },
  "glm-fireworks": {
    agent: "glm_worker",
    model: "fireworks-ai/accounts/fireworks/models/glm-5p2",
  },
  "glm-fireworks-fast": {
    agent: "glm_worker",
    model: "fireworks-ai/accounts/fireworks/routers/glm-5p2-fast",
  },
  kimi: {
    agent: "kimi_reader",
    model: "baseten/moonshotai/Kimi-K2.7-Code",
  },
  "kimi-fireworks": {
    agent: "kimi_reader",
    model: "fireworks-ai/accounts/fireworks/models/kimi-k2p7-code",
  },
  "kimi-fireworks-fast": {
    agent: "kimi_reader",
    model: "fireworks-ai/accounts/fireworks/routers/kimi-k2p7-code-fast",
  },
};
for (const [command, expected] of Object.entries(experimentalCommands)) {
  const source = fs.readFileSync(
    path.join(repoRoot, "opencode", "commands", `${command}.md`),
    "utf8",
  );
  if (!source.startsWith("---\n") || !source.includes(`\nagent: ${expected.agent}\n`)) {
    fail(`/${command} must target ${expected.agent}`);
  }
  if (!source.includes(`\nmodel: ${expected.model}\n`)) {
    fail(`/${command} must pin ${expected.model}`);
  }
  if (!source.includes("\nsubtask: true\n")) {
    fail(`/${command} must remain an explicit isolated subtask`);
  }
  const resolved = resolvedConfig.command?.[command];
  if (!resolved) {
    fail(`/${command} is missing from resolved OpenCode commands`);
  }
  if (resolved.agent !== expected.agent || resolved.model !== expected.model) {
    fail(`/${command} resolved to ${resolved.agent ?? "no agent"} and ${resolved.model ?? "no model"}`);
  }
  if (resolved.subtask !== true) {
    fail(`/${command} must resolve as an isolated subtask`);
  }
}

const explore = agents.explore;
if (finalPermission(explore, "synthetic_external_mutation") !== "deny") {
  fail("explore must deny unknown external tools");
}
for (const permission of ["question", "edit", "bash", "task", "todowrite", "advisor"]) {
  if (finalPermission(explore, permission) !== "deny") {
    fail(`explore must deny ${permission}`);
  }
}

const general = agents.general;
if (finalPermission(general, "synthetic_external_mutation") !== "deny") {
  fail("general must deny unknown external tools during unattended delegation");
}
for (const permission of ["task", "todowrite", "advisor"]) {
  if (finalPermission(general, permission) !== "deny") {
    fail(`general must deny recursive ${permission}`);
  }
}
if (finalPermission(general, "question") !== "deny") {
  fail("general must not pause unattended delegation for interactive questions");
}
for (const pattern of [
  "rm -rf *",
  "sudo *",
  "git reset --hard",
  "git reset --hard *",
  "git clean *",
  "git push",
  "git push *",
]) {
  if (finalPermission(general, "bash", pattern) !== "deny") {
    fail(`general must deny authority-requiring shell pattern ${pattern}`);
  }
}
if (general.tools?.task === true || general.tools?.todowrite === true) {
  fail("general must not expose recursive Task or TodoWrite tools");
}
for (const tool of ["apply_patch", "edit", "write", "bash", "task", "todowrite"]) {
  if (explore.tools?.[tool] === true) {
    fail(`explore must not expose ${tool}`);
  }
}

const plan = agents.plan;
if (finalPermission(plan, "edit") !== "deny") {
  fail("plan must deny editing");
}
if (finalPermission(plan, "bash") !== "ask") {
  fail("plan must ask before shell execution");
}
if (finalPermission(plan, "task", "*") !== "deny") {
  fail("plan must deny Task by default");
}
if (finalPermission(plan, "advisor") !== "deny") {
  fail("plan must deny the external advisor tool");
}
if (finalPermission(plan, "synthetic_external_mutation") !== "ask") {
  fail("plan must ask before using unknown external tools");
}
const planTaskAllowlist = new Set([
  "accessibility_auditor",
  "code_reviewer",
  "explore",
  "security_engineer",
  "software_architect",
]);
for (const name of planTaskAllowlist) {
  const child = agents[name];
  if (!child) fail(`plan allowlisted missing child ${name}`);
  for (const permission of ["edit", "task", "todowrite", "advisor"]) {
    if (finalPermission(child, permission) !== "deny") {
      fail(`plan child ${name} must deny ${permission}`);
    }
  }
  if (!new Set(["ask", "deny"]).has(finalPermission(child, "bash"))) {
    fail(`plan child ${name} may only ask or deny shell execution`);
  }
  if (finalPermission(child, "synthetic_external_mutation") !== "deny") {
    fail(`plan child ${name} must deny unknown external tools`);
  }
}
for (const name of managedAgentNames) {
  const expected = planTaskAllowlist.has(name) ? "allow" : "deny";
  if (finalPermission(plan, "task", name) !== expected) {
    fail(`plan must ${expected} task delegation to ${name}`);
  }
}

const reviewedReadOnlyAgents = new Map([
  ["accessibility_auditor", { bash: "deny", grep: "deny" }],
  ["code_reviewer", { bash: "deny", grep: "deny" }],
  ["database_optimizer", { bash: "deny", grep: "deny" }],
  ["evidence_analyst", { bash: "deny", grep: "deny" }],
  ["kimi_reader", { bash: "deny", grep: "deny" }],
  ["security_engineer", { bash: "deny", grep: "deny" }],
  ["software_architect", { bash: "deny", grep: "deny" }],
]);
for (const [name, expected] of reviewedReadOnlyAgents) {
  const child = agents[name];
  if (!child) fail(`reviewed read-only agent ${name} is unavailable`);
  if (child.mode !== "subagent") {
    fail(`${name} must remain a subagent`);
  }
  if (finalPermission(child, "read") !== "allow") {
    fail(`${name} must retain source read access`);
  }
  for (const [permission, action] of Object.entries(expected)) {
    if (finalPermission(child, permission) !== action) {
      fail(`${name} must ${action} ${permission}`);
    }
  }
  for (const permission of [
    "question",
    "edit",
    "webfetch",
    "task",
    "todowrite",
    "advisor",
    ...goalMutationTools,
  ]) {
    if (finalPermission(child, permission) !== "deny") {
      fail(`${name} must deny ${permission}`);
    }
  }
  if (finalPermission(child, "synthetic_external_mutation") !== "deny") {
    fail(`${name} must deny unknown external tools`);
  }
}

const glmWorker = agents.glm_worker;
if (glmWorker.mode !== "subagent") {
  fail("glm_worker must remain a subagent");
}
if (glmWorker.variant !== "max") {
  fail("glm_worker must retain the max reasoning variant across provider-pinned commands");
}
for (const [permission, action] of Object.entries({
  question: "deny",
  read: "allow",
  edit: "allow",
  bash: "ask",
  grep: "ask",
  webfetch: "deny",
  task: "deny",
  todowrite: "deny",
  advisor: "deny",
})) {
  if (finalPermission(glmWorker, permission) !== action) {
    fail(`glm_worker must ${action} ${permission}`);
  }
}
for (const permission of goalMutationTools) {
  if (finalPermission(glmWorker, permission) !== "deny") {
    fail(`glm_worker must deny ${permission}`);
  }
}
if (finalPermission(glmWorker, "synthetic_external_mutation") !== "deny") {
  fail("glm_worker must deny unknown external tools");
}
for (const name of ["general", "glm_worker", "database_optimizer", "evidence_analyst"]) {
  if (finalPermission(plan, "task", name) !== "deny") {
    fail(`plan must deny writable task delegation to ${name}`);
  }
}

const expectedModels = {
  build: ["openai", "gpt-5.6-terra-xhigh-pinned"],
  glm_worker: ["baseten", "zai-org/GLM-5.2"],
  kimi_reader: ["baseten", "moonshotai/Kimi-K2.7-Code"],
  plan: ["openai", "gpt-5.6-terra-xhigh-pinned"],
  advisor_reviewer: ["anthropic", "claude-opus-4-8-xhigh-pinned"],
};
if (modelRouting.agents?.compaction) {
  expectedModels.compaction = undefined;
}
for (const [name, fallback] of Object.entries(expectedModels)) {
  if (disabledAgentNames.has(name)) continue;
  const configuredModel = modelRouting.agents?.[name];
  const [providerID, modelID] = configuredModel
    ? [
        configuredModel.slice(0, configuredModel.indexOf("/")),
        configuredModel.slice(configuredModel.indexOf("/") + 1),
      ]
    : fallback;
  const model = agents[name].model;
  if (model.providerID !== providerID || model.modelID !== modelID) {
    fail(`${name} resolved to ${model.providerID}/${model.modelID}`);
  }
}

for (const name of inheritedModelAgents) {
  const configuredModel = modelRouting.agents?.[name];
  if (!configuredModel) {
    if (config.agent?.[name]?.model !== undefined) {
      fail(`${name} must inherit its invoking primary model by default`);
    }
    continue;
  }
  const separator = configuredModel.indexOf("/");
  const providerID = configuredModel.slice(0, separator);
  const modelID = configuredModel.slice(separator + 1);
  const model = agents[name].model;
  if (model.providerID !== providerID || model.modelID !== modelID) {
    fail(`${name} did not use its explicit machine-local model override`);
  }
}

for (const name of ["glm_worker", "kimi_reader"]) {
  if (agents[name].mode !== "subagent" || agents[name].hidden !== true) {
    fail(`${name} must remain a hidden command-only experiment`);
  }
}

if (!disabledAgentNames.has("advisor_reviewer")) {
  const reviewer = agents.advisor_reviewer;
  if (reviewer.mode !== "subagent" || reviewer.hidden !== true) {
    fail("advisor_reviewer must remain a hidden command-only subagent");
  }
  for (const permission of [
    "question",
    "edit",
    "bash",
    "task",
    "todowrite",
    "advisor",
    ...goalMutationTools,
  ]) {
    if (finalPermission(reviewer, permission) !== "deny") {
      fail(`advisor_reviewer must deny ${permission}`);
    }
  }
  if (finalPermission(reviewer, "read") !== "allow") {
    fail("advisor_reviewer must retain read-only source access");
  }
  if (finalPermission(reviewer, "synthetic_external_mutation") !== "deny") {
    fail("advisor_reviewer must deny unknown external tools");
  }
}

const adviseCommandPath = path.join(configDir, "commands", "advise.md");
if (modelRouting.advisor_enabled ?? true) {
  if (!fs.existsSync(adviseCommandPath)) {
    fail("enabled advisor lane must install /advise");
  }
  const adviseCommand = fs.readFileSync(adviseCommandPath, "utf8");
  if (
    !adviseCommand.includes("agent: advisor_reviewer") ||
    !adviseCommand.includes("subtask: true")
  ) {
    fail("advise command must use the isolated advisor_reviewer subtask");
  }
} else if (fs.existsSync(adviseCommandPath)) {
  fail("disabled advisor lane must not expose /advise");
}

if (withPlugins) {
  const workflowGuardPath = path.join(
    configDir,
    "plugins",
    "goal-workflow-guard.js",
  );
  if (!fs.existsSync(workflowGuardPath)) {
    fail("the managed Goal workflow guard plugin is not installed");
  }
  const configWithPlugins = debugConfig(true);
  const pluginSpecs = (configWithPlugins.plugin ?? []).map((plugin) =>
    Array.isArray(plugin) ? plugin[0] : plugin
  );
  const goalPluginIndex = pluginSpecs.findIndex((plugin) =>
    String(plugin).startsWith("@prevalentware/opencode-goal-plugin@0.1.24")
  );
  const workflowGuardIndex = pluginSpecs.findIndex((plugin) =>
    String(plugin).endsWith("/plugins/goal-workflow-guard.js")
  );
  if (goalPluginIndex === -1 || workflowGuardIndex === -1) {
    fail("Goal and its managed workflow guard must both be configured");
  }
  if (workflowGuardIndex <= goalPluginIndex) {
    fail("the Goal workflow guard must load after Goal");
  }
  const buildWithPlugins = debugAgent("build", true);
  if (
    ["1", "true"].includes(
      String(process.env.OPENCODE_EXPERIMENTAL_LSP_TOOL).toLowerCase(),
    ) && buildWithPlugins.tools?.lsp !== true
  ) {
    fail("the enabled experimental LSP tool is missing from build");
  }
  for (const tool of ["get_goal", "create_goal", "update_goal_status"]) {
    if (buildWithPlugins.tools?.[tool] !== true) {
      fail(`build is missing installed plugin tool ${tool}`);
    }
  }
  if (buildWithPlugins.tools?.advisor === true) {
    fail("build must not expose an installed external advisor tool");
  }
  for (const name of ["general", "evidence_analyst"]) {
    const childWithPlugins = debugAgent(name, true);
    for (const tool of ["create_goal", "update_goal_status"]) {
      if (childWithPlugins.tools?.[tool] !== false) {
        fail(`${name} must not expose installed mutation tool ${tool}`);
      }
    }
    if (childWithPlugins.tools?.advisor === true) {
      fail(`${name} must not expose an installed external advisor tool`);
    }
  }
}

console.log(
  `OK     ${agentNames.length} OpenCode agent definitions${withPlugins ? " with plugins" : ""}`,
);
