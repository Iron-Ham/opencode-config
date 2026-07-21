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
  externalDirectory?.["~/.ssh/**"] !== "deny"
) {
  fail("the managed home-directory policy is missing or does not protect credentials");
}

for (const pluginName of [
  "goal-mode.js",
  "goal-mode-tui.tsx",
  "compaction-observability.js",
  "delegation-guard.js",
  "goal-workflow-guard.js",
  "tool-output-containment.js",
]) {
  if (!fs.existsSync(path.join(configDir, "plugins", pluginName))) {
    fail(`the managed OpenCode ${pluginName} plugin asset is not installed`);
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
  if (plugins.some((plugin) =>
    String(pluginSpecifier(plugin)).startsWith("@prevalentware/opencode-goal-plugin")
  )) {
    fail("the external Goal plugin remains configured");
  }
}
for (const pluginPath of [
  "./plugins/goal-mode.js",
  "./plugins/goal-workflow-guard.js",
  "./plugins/compaction-observability.js",
  "./plugins/delegation-guard.js",
  "./plugins/tool-output-containment.js",
]) {
  if ((config.plugin ?? []).some((plugin) => pluginSpecifier(plugin) === pluginPath)) {
    fail(`the auto-discovered plugin ${pluginPath} must not also be configured explicitly`);
  }
}
if (!(tui.plugin ?? []).includes("./plugins/goal-mode-tui.tsx")) {
  fail("the vendored Goal TUI is not configured");
}
const goalModeSource = fs.readFileSync(
  path.join(repoRoot, "opencode", "plugins", "goal-mode.js"),
  "utf8",
);
if (goalModeSource.includes('from "zod"')) {
  fail("the vendored Goal server must not require zod at runtime");
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
