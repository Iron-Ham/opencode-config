#!/usr/bin/env bun

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const result = { configDir: process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode"), json: false };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--json") result.json = true;
    else if (argv[index] === "--config-dir") result.configDir = argv[++index];
    else throw new Error(`unsupported argument: ${argv[index]}`);
  }
  return result;
}

function check(checks, level, name, detail) {
  checks.push({ level, name, detail });
}

function readJson(filePath, checks, name) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    check(checks, "error", name, error instanceof Error ? error.message : String(error));
    return null;
  }
}

function pluginSpecifier(plugin) {
  return Array.isArray(plugin) ? plugin[0] : plugin;
}

function configuredModelBudget(config) {
  const model = config.model;
  if (typeof model !== "string") return null;
  const separator = model.indexOf("/");
  if (separator <= 0 || separator === model.length - 1) return null;
  const providerID = model.slice(0, separator);
  const modelID = model.slice(separator + 1);
  const limit = config.provider?.[providerID]?.models?.[modelID]?.limit;
  if (!limit || !Number.isInteger(limit.input) || limit.input <= 0) return null;
  return { model, input: limit.input };
}

function validCompactionObservation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(["event", "model_strategy", "observed_at", "schema_version", "session_sha256"])) return false;
  return value.schema_version === 1 && (value.event === "started" || value.event === "autocontinue") && value.model_strategy === "active-session" && /^sha256:[a-f0-9]{64}$/.test(value.session_sha256) && Number.isFinite(Date.parse(value.observed_at));
}

export function diagnoseOpenCode({ configDir, environment = process.env } = {}) {
  const resolvedConfigDir = path.resolve(configDir || environment.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode"));
  const checks = [];
  const config = readJson(path.join(resolvedConfigDir, "opencode.json"), checks, "configuration");
  if (config) {
    check(checks, config.share === "disabled" ? "ok" : "error", "sharing", config.share === "disabled" ? "sharing is disabled" : "managed configuration must set share to disabled");
    check(checks, config.compaction?.model == null ? "ok" : "error", "compaction route", config.compaction?.model == null ? "compaction inherits the active session route" : "a separate compaction model is configured");
    check(checks, config.compaction?.auto === true && Number.isInteger(config.compaction?.reserved) && config.compaction.reserved > 0 ? "ok" : "error", "compaction settings", config.compaction?.auto === true ? `automatic compaction retains a ${config.compaction.reserved}-token reserve` : "automatic compaction with a positive reserve is required");
    const compaction = config.compaction ?? {};
    const retentionConfigured = (compaction.prune === undefined || typeof compaction.prune === "boolean") && Number.isInteger(compaction.tail_turns) && compaction.tail_turns >= 0 && Number.isInteger(compaction.preserve_recent_tokens) && compaction.preserve_recent_tokens > 0;
    check(checks, retentionConfigured ? "ok" : "warning", "compaction retention", retentionConfigured ? `prune ${compaction.prune === undefined ? "default" : compaction.prune}, ${compaction.tail_turns} tail turns, ${compaction.preserve_recent_tokens} recent tokens` : "prune, tail turns, or preserved recent tokens are not fully configured");
    const toolOutput = config.tool_output;
    check(checks, Number.isInteger(toolOutput?.max_lines) && toolOutput.max_lines > 0 && Number.isInteger(toolOutput?.max_bytes) && toolOutput.max_bytes > 0 ? "ok" : "warning", "tool output bounds", Number.isInteger(toolOutput?.max_lines) && Number.isInteger(toolOutput?.max_bytes) ? `${toolOutput.max_lines} lines / ${toolOutput.max_bytes} bytes` : "tool output bounds are not fully configured");
    const budget = configuredModelBudget(config);
    if (!budget) {
      check(checks, "warning", "context reserve", "the configured model has no static operational input limit");
    } else {
      const reserve = config.compaction?.reserved;
      const validReserve = Number.isInteger(reserve) && reserve > 0 && reserve < budget.input;
      check(checks, validReserve ? "ok" : "error", "context reserve", validReserve ? `${budget.model}: ${reserve}-token reserve inside the ${budget.input}-token input limit` : `${budget.model}: reserve must be a positive integer below the ${budget.input}-token input limit`);
    }
    check(checks, "warning", "automatic compaction target", "OpenCode does not expose an explicit automatic-compaction target; use manual /compact before context becomes expensive.");
    const managedPlugins = ["goal-mode.js", "goal-workflow-guard.js", "compaction-observability.js", "delegation-guard.js", "tool-output-containment.js"];
    const configuredPlugins = config.plugin ?? [];
    for (const pluginName of managedPlugins) {
      const pluginPath = `./plugins/${pluginName}`;
      const installed = fs.existsSync(path.join(resolvedConfigDir, "plugins", pluginName));
      const duplicated = configuredPlugins.some((plugin) => pluginSpecifier(plugin) === pluginPath);
      check(checks, installed && !duplicated ? "ok" : "error", `plugin ${pluginPath}`, installed ? duplicated ? "auto-discovered plugin is also configured explicitly" : "auto-discovered" : "missing from the plugin directory");
    }
  }

  const routingPath = path.join(resolvedConfigDir, "model-routing.config.local.json");
  if (!fs.existsSync(routingPath)) {
    check(checks, "warning", "local routing", "no local routing override is configured");
  } else {
    const routing = readJson(routingPath, checks, "local routing");
    if (routing) {
      const secure = (fs.statSync(routingPath).mode & 0o077) === 0;
      check(checks, secure ? "ok" : "error", "local routing permissions", secure ? "private permissions are set" : "local routing configuration must not be group/world readable");
      check(checks, routing.advisor_enabled === true || routing.advisor_enabled === false ? "ok" : "error", "advisor isolation", "advisor_enabled must be an explicit boolean");
    }
  }

  const observationDirectory = environment.OPENCODE_COMPACTION_OBSERVATION_DIR || path.join(environment.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"), "opencode", "compaction-observations");
  if (!fs.existsSync(observationDirectory)) {
    check(checks, "warning", "compaction observations", "no compaction observations have been recorded yet");
  } else {
    const records = fs.readdirSync(observationDirectory).filter((name) => name.endsWith(".json"));
    const secure = (fs.statSync(observationDirectory).mode & 0o077) === 0;
    check(checks, secure ? "ok" : "error", "compaction observation permissions", secure ? `${records.length} private observation records` : "observation directory must not be group/world readable");
    for (const record of records) {
      const value = readJson(path.join(observationDirectory, record), checks, `compaction observation ${record}`);
      if (value) check(checks, validCompactionObservation(value) ? "ok" : "error", `compaction observation ${record}`, "record must have the exact privacy-safe compaction observation schema");
    }
  }
  return { healthy: !checks.some((item) => item.level === "error"), config_dir: resolvedConfigDir, checks };
}

if (import.meta.main) {
  const options = parseArgs(process.argv.slice(2));
  const report = diagnoseOpenCode(options);
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else for (const item of report.checks) console.log(`${item.level.toUpperCase().padEnd(7)} ${item.name}: ${item.detail}`);
  process.exitCode = report.healthy ? 0 : 1;
}
