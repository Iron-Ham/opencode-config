#!/usr/bin/env bun

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { isDeepStrictEqual } from "node:util";
import { inspectPolicyInstallation } from "./resolve-opencode-policy.mjs";

const repoRoot = path.resolve(process.argv[2]);
const configDir = path.resolve(process.argv[3]);
const requireInstalledAssets = process.argv.includes("--require-installed-assets");
const externalHomeDirectoryPattern = path.join(os.homedir(), "**");
const cargoCredentialPattern = path.join(os.homedir(), ".cargo", "**");
const sshCredentialPattern = path.join(os.homedir(), ".ssh", "**");
const managedWorktreePattern = path.join(
  os.homedir(),
  ".local",
  "share",
  "opencode",
  "worktree",
  "**",
);
const temporaryWorktreePattern = "/private/var/folders/**/T/opencode/**";
const isolatedXdgConfigHome = fs.mkdtempSync(
  path.join(os.tmpdir(), "opencode-agent-validation-xdg-"),
);
process.on("exit", () => {
  fs.rmSync(isolatedXdgConfigHome, { recursive: true, force: true });
});

function fail(message) {
  throw new Error(`OpenCode agent validation failed: ${message}`);
}

async function debugAgent(name) {
  const command = ["opencode", "debug", "agent", name];
  command.push("--pure");
  const result = Bun.spawn(command, {
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      XDG_CONFIG_HOME: isolatedXdgConfigHome,
      OPENCODE_CONFIG_DIR: configDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    result.exited,
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
  ]);
  if (exitCode !== 0) {
    fail(`${name} could not be resolved: ${stderr.trim()}`);
  }
  try {
    return JSON.parse(stdout);
  } catch (error) {
    fail(`${name} returned invalid debug JSON: ${error.message}`);
  }
}

function executeAgentTool(name, tool, params) {
  const result = Bun.spawnSync([
    "opencode",
    "debug",
    "agent",
    name,
    "--pure",
    "--tool",
    tool,
    "--params",
    JSON.stringify(params),
  ], {
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      XDG_CONFIG_HOME: isolatedXdgConfigHome,
      OPENCODE_CONFIG_DIR: configDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    exitCode: result.exitCode,
    output: `${result.stdout.toString()}${result.stderr.toString()}`,
  };
}

async function debugConfig() {
  const command = ["opencode", "debug", "config"];
  command.push("--pure");
  const result = Bun.spawn(command, {
    cwd: os.tmpdir(),
    env: {
      ...process.env,
      XDG_CONFIG_HOME: isolatedXdgConfigHome,
      OPENCODE_CONFIG_DIR: configDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    result.exited,
    new Response(result.stdout).text(),
    new Response(result.stderr).text(),
  ]);
  if (exitCode !== 0) {
    fail(`resolved config could not be loaded: ${stderr.trim()}`);
  }
  try {
    return JSON.parse(stdout);
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
  : { policy_adapter_enabled: true, agents: {}, steps: {} };
let policyValidation;
try {
  policyValidation = inspectPolicyInstallation({ repoRoot, configDir });
} catch (error) {
  fail(error instanceof Error ? error.message : "policy manifest validation failed");
}
const retiredManagedAgentNames = new Set([
  "advisor_reviewer",
  "backend_architect",
  "evidence_collector",
  "frontend_developer",
  "git_workflow_master",
  "glm_worker",
  "kimi_reader",
  "periphery-fixer",
  "sol_reviewer",
  "technical_writer",
  "ultra",
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
  ...managedAgentNames,
])].filter((name) => !disabledAgentNames.has(name)).sort();
const agents = Object.fromEntries(await Promise.all(
  agentNames.map(async (name) => [name, await debugAgent(name)]),
));
const resolvedConfig = await debugConfig();
const inheritedModelAgents = [
  "accessibility_auditor",
  "build",
  "code_reviewer",
  "database_optimizer",
  "evidence_analyst",
  "explore",
  "general",
  "security_engineer",
  "software_architect",
];
const inheritedModelAgentNames = new Set(inheritedModelAgents);
const {
  task: managedBuildTask,
} = managedDefaults.agent.build.permission;
if (!isDeepStrictEqual(managedBuildTask, { "*": "allow" })) {
  fail("managed Build Task permissions must allow every subagent");
}
const expectedGeneralTask = [
  ["*", "deny"],
  ["code_reviewer", "allow"],
];
if (!isDeepStrictEqual(
  Object.entries(config.agent?.general?.permission?.task ?? {}),
  expectedGeneralTask,
)) {
  fail("managed general Task permissions must only allow code_reviewer");
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
  if (
    finalPermission(agent, "external_directory", externalHomeDirectoryPattern) !==
      "allow"
  ) {
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
  if (finalPermission(agent, "external_directory", cargoCredentialPattern) !== "deny") {
    fail(`${name} must deny external Cargo credential files`);
  }
  if (finalPermission(agent, "external_directory", managedWorktreePattern) !== "allow") {
    fail(`${name} must allow managed OpenCode worktrees`);
  }
  if (finalPermission(agent, "external_directory", temporaryWorktreePattern) !== "allow") {
    fail(`${name} must allow temporary OpenCode worktrees`);
  }
}

const externalSourceProbe = path.join(
  repoRoot,
  "opencode",
  "opencode.defaults.json",
);
for (const name of ["general", "explore", "code_reviewer"]) {
  const result = executeAgentTool(name, "read", {
    filePath: externalSourceProbe,
    offset: 1,
    limit: 1,
  });
  if (result.exitCode !== 0) {
    fail(`${name} could not read an external delegated source path: ${result.output.trim()}`);
  }
}
for (const protectedPath of [
  path.join(os.homedir(), ".cargo", "credentials.toml"),
  path.join(os.homedir(), ".ssh", "__opencode_permission_probe__"),
]) {
  const result = executeAgentTool("code_reviewer", "read", {
    filePath: protectedPath,
    offset: 1,
    limit: 1,
  });
  if (
    result.exitCode === 0 ||
    !result.output.includes("prevents you from using this specific tool call")
  ) {
    fail(`code_reviewer must deny direct reads of ${protectedPath}`);
  }
}

const retiredGoalTools = [
  "get_goal",
  "get_goal_history",
  "create_goal",
  "set_goal",
  "update_goal_objective",
  "update_goal",
  "update_goal_status",
  "clear_goal",
  "record_goal_progress",
  "record_goal_failure",
];
for (const permission of retiredGoalTools) {
  if (Object.hasOwn(managedDefaults.permission ?? {}, permission)) {
    fail(`managed defaults retain the retired ${permission} permission`);
  }
  for (const [name, agent] of Object.entries(managedDefaults.agent ?? {})) {
    if (Object.hasOwn(agent.permission ?? {}, permission)) {
      fail(`managed ${name} retains the retired ${permission} permission`);
    }
  }
}
for (const command of [
  "advise",
  "glm",
  "glm-fireworks",
  "glm-fireworks-fast",
  "goal",
  "kimi",
  "kimi-fireworks",
  "kimi-fireworks-fast",
  "ultra",
]) {
  if (resolvedConfig.command?.[command] !== undefined) {
    fail(`retired /${command} command remains resolved`);
  }
}
for (const agent of ["advisor_reviewer", "glm_worker", "kimi_reader", "ultra"]) {
  if (modelRouting.agents?.[agent] !== undefined || modelRouting.steps?.[agent] !== undefined) {
    fail(`retired ${agent} routing override remains configured`);
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
if (finalPermission(general, "task", "*") !== "deny") {
  fail("general must deny Task by default");
}
for (const name of new Set([
  "build",
  "plan",
  "general",
  "explore",
  "compaction",
  ...managedAgentNames,
])) {
  const expected = name === "code_reviewer" ? "allow" : "deny";
  if (finalPermission(general, "task", name) !== expected) {
    fail(`general must ${expected} task delegation to ${name}`);
  }
}
for (const permission of ["todowrite", "advisor"]) {
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
if (general.tools?.task !== true) {
  fail("general must expose Task for code_reviewer delegation");
}
if (general.tools?.todowrite === true) {
  fail("general must not expose TodoWrite");
}
for (const tool of ["apply_patch", "edit", "write", "bash", "task", "todowrite"]) {
  if (explore.tools?.[tool] === true) {
    fail(`explore must not expose ${tool}`);
  }
}

const plan = agents.plan;
if (finalPermission(plan, "edit", "*") !== "deny") {
  fail("plan must deny non-Markdown edits by default");
}
if (finalPermission(plan, "edit", "*.md") !== "allow") {
  fail("plan must allow Markdown edits");
}
if (finalPermission(plan, "edit", "**/*.md") !== "allow") {
  fail("plan must allow Markdown edits in subdirectories");
}
if (finalPermission(plan, "edit", "*.ts") !== "deny") {
  fail("plan must deny source-file edits");
}
if (plan.tools?.apply_patch !== true) {
  fail("plan must expose ApplyPatch for Markdown plans");
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
  ]) {
    if (finalPermission(child, permission) !== "deny") {
      fail(`${name} must deny ${permission}`);
    }
  }
  if (finalPermission(child, "synthetic_external_mutation") !== "deny") {
    fail(`${name} must deny unknown external tools`);
  }
}

for (const name of ["general", "database_optimizer", "evidence_analyst"]) {
  if (finalPermission(plan, "task", name) !== "deny") {
    fail(`plan must deny writable task delegation to ${name}`);
  }
}

const expectedModels = {
  plan: ["openai", "gpt-5.6-terra"],
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

if (requireInstalledAssets) {
  for (const asset of [
    path.join("agents", "advisor_reviewer.md"),
    path.join("agents", "glm_worker.md"),
    path.join("agents", "kimi_reader.md"),
    path.join("agents", "ultra.md"),
    path.join("commands", "advise.md"),
    path.join("commands", "glm.md"),
    path.join("commands", "glm-fireworks.md"),
    path.join("commands", "glm-fireworks-fast.md"),
    path.join("commands", "goal.md"),
    path.join("commands", "kimi.md"),
    path.join("commands", "kimi-fireworks.md"),
    path.join("commands", "kimi-fireworks-fast.md"),
    path.join("commands", "ultra.md"),
    path.join("plugins", "goal-mode.js"),
    path.join("plugins", "goal-mode.LICENSE"),
    path.join("plugins", "goal-mode-tui.tsx"),
    path.join("plugins", "goal-workflow-guard.js"),
  ]) {
    if (fs.existsSync(path.join(configDir, asset))) {
      fail(`retired ${asset} asset remains installed`);
    }
  }
}

console.log(`OK     ${agentNames.length} OpenCode agent definitions`);
if (policyValidation.state === "disabled") {
  console.log("OK     OpenCode policy adapter disabled without manifest loading");
} else {
  console.log(
    `OK     OpenCode policy manifest v${policyValidation.policy_version} ${policyValidation.configuration_hash}`,
  );
}
