#!/usr/bin/env bun

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const repoRoot = path.resolve(process.argv[2]);
const configDir = path.resolve(process.argv[3]);
const withPlugins = process.argv.includes("--with-plugins");

function fail(message) {
  throw new Error(`OpenCode agent validation failed: ${message}`);
}

function debugAgent(name, plugins = false) {
  const command = ["opencode", "debug", "agent", name];
  if (!plugins) command.push("--pure");
  const result = Bun.spawnSync(command, {
    cwd: os.tmpdir(),
    env: { ...process.env, OPENCODE_CONFIG_DIR: configDir },
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

function finalPermission(agent, permission, pattern = "*") {
  let action;
  for (const rule of agent.permission ?? []) {
    if (
      (rule.permission === "*" || rule.permission === permission) &&
      (rule.pattern === "*" || rule.pattern === pattern)
    ) {
      action = rule.action;
    }
  }
  return action;
}

const managedAgentNames = fs.readdirSync(path.join(repoRoot, "opencode", "agents"))
  .filter((name) => name.endsWith(".md"))
  .map((name) => path.basename(name, ".md"));
const agentNames = [...new Set([
  "build",
  "plan",
  "general",
  "explore",
  "compaction",
  "luna",
  "sonnet",
  "terra",
  "ultra",
  ...managedAgentNames,
])].sort();
const agents = Object.fromEntries(agentNames.map((name) => [name, debugAgent(name)]));

for (const [name, agent] of Object.entries(agents)) {
  if (!agent.model?.providerID || !agent.model?.modelID) {
    fail(`${name} has no resolved model`);
  }
}
const advisorActions = {
  build: "ask",
  plan: "ask",
  luna: "ask",
  sonnet: "ask",
  terra: "ask",
  ultra: "allow",
};
for (const [name, agent] of Object.entries(agents)) {
  const expected = advisorActions[name] ?? "deny";
  if (finalPermission(agent, "advisor") !== expected) {
    fail(`${name} must ${expected} advisor access`);
  }
}
const goalControllers = new Set(["build", "luna", "sonnet", "terra", "ultra"]);
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

const explore = agents.explore;
if (finalPermission(explore, "synthetic_external_mutation") !== "deny") {
  fail("explore must deny unknown external tools");
}
for (const permission of ["edit", "bash", "task", "todowrite", "advisor"]) {
  if (finalPermission(explore, permission) !== "deny") {
    fail(`explore must deny ${permission}`);
  }
}

const general = agents.general;
if (finalPermission(general, "synthetic_external_mutation") !== "ask") {
  fail("general must ask before using unknown external tools");
}
for (const permission of ["task", "todowrite", "advisor"]) {
  if (finalPermission(general, permission) !== "deny") {
    fail(`general must deny recursive ${permission}`);
  }
}
if (general.tools?.task !== false || general.tools?.todowrite !== false) {
  fail("general must not expose recursive Task or TodoWrite tools");
}
for (const tool of ["edit", "write", "bash", "task", "todowrite"]) {
  if (explore.tools?.[tool] !== false) {
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
if (finalPermission(plan, "advisor") !== "ask") {
  fail("plan must ask before its single cost-gated advisor path");
}
if (finalPermission(plan, "synthetic_external_mutation") !== "ask") {
  fail("plan must ask before using unknown external tools");
}
const planTaskAllowlist = new Set([
  "accessibility_auditor",
  "code_reviewer",
  "database_optimizer",
  "evidence_collector",
  "explore",
  "git_workflow_master",
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
  const unknownAction = finalPermission(child, "synthetic_external_mutation");
  const expectedUnknownAction = name === "explore" ? "deny" : "ask";
  if (unknownAction !== expectedUnknownAction) {
    fail(`plan child ${name} must ${expectedUnknownAction} unknown external tools`);
  }
}
for (const name of managedAgentNames) {
  const expected = planTaskAllowlist.has(name) ? "allow" : "deny";
  if (finalPermission(plan, "task", name) !== expected) {
    fail(`plan must ${expected} task delegation to ${name}`);
  }
}
for (const name of ["general", "glm_worker", "backend_architect", "frontend_developer", "technical_writer"]) {
  if (finalPermission(plan, "task", name) !== "deny") {
    fail(`plan must deny writable task delegation to ${name}`);
  }
}

const expectedModels = {
  build: ["openai", "gpt-5.6-luna-xhigh-pinned"],
  general: ["openai", "gpt-5.6-luna-xhigh-pinned"],
  compaction: ["anthropic", "claude-sonnet-5"],
  explore: ["baseten", "moonshotai/Kimi-K2.7-Code"],
  luna: ["openai", "gpt-5.6-luna-xhigh-pinned"],
  sonnet: ["anthropic", "claude-sonnet-5-default-pinned"],
  terra: ["openai", "gpt-5.6-terra-xhigh-pinned"],
  ultra: ["anthropic", "claude-sonnet-5-max-pinned"],
};
for (const [name, [providerID, modelID]] of Object.entries(expectedModels)) {
  const model = agents[name].model;
  if (model.providerID !== providerID || model.modelID !== modelID) {
    fail(`${name} resolved to ${model.providerID}/${model.modelID}`);
  }
}

if (withPlugins) {
  const buildWithPlugins = debugAgent("build", true);
  for (const tool of ["advisor", "get_goal", "create_goal", "update_goal_status"]) {
    if (buildWithPlugins.tools?.[tool] !== true) {
      fail(`build is missing installed plugin tool ${tool}`);
    }
  }
  for (const name of ["general", "evidence_collector"]) {
    const childWithPlugins = debugAgent(name, true);
    for (const tool of ["advisor", "create_goal", "update_goal_status"]) {
      if (childWithPlugins.tools?.[tool] !== false) {
        fail(`${name} must not expose installed mutation tool ${tool}`);
      }
    }
  }
}

console.log(
  `OK     ${agentNames.length} OpenCode agent definitions${withPlugins ? " with plugins" : ""}`,
);
