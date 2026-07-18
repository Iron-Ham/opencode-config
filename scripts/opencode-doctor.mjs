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
    const plugins = config.plugin ?? [];
    for (const required of ["./plugins/goal-mode.js", "./plugins/goal-workflow-guard.js", "./plugins/compaction-observability.js", "./plugins/delegation-guard.js"]) {
      check(checks, plugins.some((plugin) => pluginSpecifier(plugin) === required) ? "ok" : "error", `plugin ${required}`, plugins.some((plugin) => pluginSpecifier(plugin) === required) ? "configured" : "missing");
    }
    const observer = plugins.find((plugin) => pluginSpecifier(plugin) === "./plugins/compaction-observability.js");
    check(checks, Array.isArray(observer) && observer[1]?.model_strategy === "active-session" ? "ok" : "error", "compaction observer strategy", "compaction observability must use active-session inheritance");
    const delegationGuard = plugins.find((plugin) => pluginSpecifier(plugin) === "./plugins/delegation-guard.js");
    check(checks, Array.isArray(delegationGuard) && delegationGuard[1]?.max_concurrent === 4 && delegationGuard[1]?.max_total === 8 ? "ok" : "error", "delegation limits", "delegation guard must enforce four concurrent and eight total tasks");
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
