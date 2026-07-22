#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(process.argv[2]);
const configDir = path.resolve(process.argv[3]);

function fail(message) {
  throw new Error(`OpenCode installation validation failed: ${message}`);
}

function readJson(relativePath) {
  const filePath = path.join(configDir, relativePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    fail(`${relativePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function pluginSpecifier(plugin) {
  return Array.isArray(plugin) ? plugin[0] : plugin;
}

const config = readJson("opencode.json");
const tui = readJson("tui.json");
const packageConfig = readJson("package.json");
const externalDirectory = config.permission?.external_directory;
if (
  externalDirectory?.["~/**"] !== "allow" ||
  externalDirectory?.["~/.cargo/**"] !== "deny" ||
  externalDirectory?.["~/.ssh/**"] !== "deny" ||
  externalDirectory?.["~/.local/share/opencode/worktree/**"] !== "allow" ||
  externalDirectory?.["/private/var/folders/**/T/opencode/**"] !== "allow"
) {
  fail("the managed worktree policy is missing or does not protect credentials");
}

for (const pluginName of [
  "compaction-observability.js",
  "delegation-guard.js",
]) {
  if (!fs.existsSync(path.join(configDir, "plugins", pluginName))) {
    fail(`the managed ${pluginName} plugin asset is not installed`);
  }
}
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
  path.join("plugins", "goal-mode.js"),
  path.join("plugins", "goal-mode.LICENSE"),
  path.join("plugins", "goal-mode-tui.tsx"),
  path.join("plugins", "goal-workflow-guard.js"),
]) {
  if (fs.existsSync(path.join(configDir, asset))) {
    fail(`the retired ${asset} asset remains installed`);
  }
}

for (const toolName of ["glob.ts", "grep.ts", "ast_grep.ts", "text_read.ts"]) {
  if (!fs.existsSync(path.join(configDir, "context-tools", toolName))) {
    fail(`the managed context-efficient ${toolName} asset is not installed`);
  }
}
for (const toolName of ["glob.ts", "grep.ts", "ast_grep.ts", "text_read.ts"]) {
  if (!fs.existsSync(path.join(configDir, "tools", toolName))) {
    fail(`the managed context-efficient ${toolName} tool is not installed`);
  }
}
for (const runtimeFile of ["runtime.ts", "text-read.ts"]) {
  if (!fs.existsSync(path.join(configDir, "context-tools-lib", runtimeFile))) {
    fail(`the managed context-efficient ${runtimeFile} runtime is not installed`);
  }
}

for (const plugins of [config.plugin ?? [], tui.plugin ?? []]) {
  for (const pluginPath of [
    "./plugins/goal-mode.js",
    "./plugins/goal-mode-tui.tsx",
    "./plugins/goal-workflow-guard.js",
  ]) {
    if (plugins.some((plugin) => pluginSpecifier(plugin) === pluginPath)) {
      fail(`the retired ${pluginPath} plugin remains configured`);
    }
  }
  if (plugins.some((plugin) =>
    String(pluginSpecifier(plugin)).startsWith("@prevalentware/opencode-goal-plugin")
  )) {
    fail("the retired external Goal plugin remains configured");
  }
  if (plugins.some((plugin) => {
    const specifier = pluginSpecifier(plugin);
    return specifier === "opencode-pty" ||
      String(specifier).startsWith("opencode-pty@");
  })) {
    fail("the incompatible opencode-pty plugin remains configured");
  }
}
for (const pluginPath of [
  "./plugins/compaction-observability.js",
  "./plugins/delegation-guard.js",
]) {
  if ((config.plugin ?? []).some((plugin) => pluginSpecifier(plugin) === pluginPath)) {
    fail(`the auto-discovered plugin ${pluginPath} must not also be configured explicitly`);
  }
}
for (const agent of ["advisor_reviewer", "glm_worker", "kimi_reader", "ultra"]) {
  if (config.agent?.[agent] !== undefined) {
    fail(`retired ${agent} agent configuration remains active`);
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
]) {
  if (config.command?.[command] !== undefined) {
    fail(`retired /${command} command configuration remains active`);
  }
}
const sourceUltraCommand = path.join(repoRoot, "opencode", "commands", "ultra.md");
const installedUltraCommand = path.join(configDir, "commands", "ultra.md");
if (!fs.existsSync(installedUltraCommand)) {
  fail("managed commands/ultra.md is not installed");
}
if (!fs.readFileSync(installedUltraCommand).equals(fs.readFileSync(sourceUltraCommand))) {
  fail("installed commands/ultra.md does not match the managed source");
}
if (config.provider?.["fireworks-ai"] !== undefined) {
  fail("the retired Fireworks experiment provider remains configured");
}
if (
  config.provider?.baseten?.models?.["zai-org/GLM-5.2"] !== undefined ||
  config.provider?.baseten?.whitelist?.some((model) =>
    ["moonshotai/Kimi-K2.7-Code", "zai-org/GLM-5.2"].includes(model)
  )
) {
  fail("retired Kimi or GLM Baseten configuration remains active");
}
if (
  packageConfig.dependencies?.["@prevalentware/opencode-goal-plugin"] !== undefined ||
  packageConfig.devDependencies?.["@prevalentware/opencode-goal-plugin"] !== undefined
) {
  fail("the retired external Goal package remains installed");
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
for (const [name, permission] of [
  ["global", config.permission],
  ...Object.entries(config.agent ?? {}).map(([agent, value]) => [agent, value?.permission]),
]) {
  if (retiredGoalTools.some((tool) => Object.hasOwn(permission ?? {}, tool))) {
    fail(`retired Goal tool permissions remain configured for ${name}`);
  }
}

for (const sourceAgent of fs.readdirSync(path.join(repoRoot, "opencode", "agents"))) {
  if (!sourceAgent.endsWith(".md")) continue;
  const installedAgent = path.join(configDir, "agents", sourceAgent);
  if (!fs.existsSync(installedAgent)) {
    fail(`managed agent ${sourceAgent} is not installed`);
  }
  const content = fs.readFileSync(installedAgent, "utf8");
  if (!content.includes("external_directory:")) {
    fail(`managed agent ${sourceAgent} does not have an external-directory policy`);
  }
}

console.log("OK     OpenCode installed configuration");
