#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-doctor-test-"));
const configDir = path.join(root, "config");
const observationDirectory = path.join(root, "observations");

try {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.mkdirSync(observationDirectory, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify({
    share: "disabled",
    model: "fixture/model",
    provider: { fixture: { models: { model: { limit: { input: 100_000 } } } } },
    tool_output: { max_lines: 300, max_bytes: 16_384 },
    compaction: { auto: true, prune: true, tail_turns: 3, preserve_recent_tokens: 12_000, reserved: 20_000 },
    metadata: { api_token: "doctor-fixture-sensitive-value" },
  }));
  fs.mkdirSync(path.join(configDir, "plugins"), { recursive: true, mode: 0o700 });
  for (const pluginName of ["goal-mode.js", "goal-workflow-guard.js", "compaction-observability.js", "delegation-guard.js"]) {
    fs.writeFileSync(path.join(configDir, "plugins", pluginName), "export default {};\n");
  }
  fs.writeFileSync(path.join(configDir, "model-routing.config.local.json"), JSON.stringify({ advisor_enabled: false }), { mode: 0o600 });
  fs.writeFileSync(path.join(observationDirectory, "record.json"), JSON.stringify({ schema_version: 1, event: "started", observed_at: "2026-07-18T00:00:00.000Z", model_strategy: "active-session", session_sha256: `sha256:${"a".repeat(64)}` }), { mode: 0o600 });
  const { diagnoseOpenCode } = await import(path.join(repoRoot, "scripts", "opencode-doctor.mjs"));
  const healthy = diagnoseOpenCode({ configDir, environment: { OPENCODE_COMPACTION_OBSERVATION_DIR: observationDirectory } });
  assert.equal(healthy.healthy, true);
  assert.equal(healthy.checks.some((item) => item.level === "error"), false);
  assert.doesNotMatch(JSON.stringify(healthy), /doctor-fixture-sensitive-value/);
  assert.deepEqual(
    healthy.checks
      .filter((item) => ["tool output bounds", "compaction retention", "context budget"].includes(item.name))
      .map((item) => [item.name, item.level, item.detail]),
    [
      ["compaction retention", "ok", "prune true, 3 tail turns, 12000 recent tokens"],
      ["tool output bounds", "ok", "300 lines / 16384 bytes"],
      ["context budget", "ok", "fixture/model: compaction threshold 80000 input tokens with 20000 reserved"],
    ],
  );
  assert.deepEqual(
    healthy.checks
      .filter((item) => [
        "plugin ./plugins/goal-mode.js",
        "plugin ./plugins/goal-workflow-guard.js",
      ].includes(item.name))
      .map((item) => [item.name, item.level]),
    [
      ["plugin ./plugins/goal-mode.js", "ok"],
      ["plugin ./plugins/goal-workflow-guard.js", "ok"],
    ],
  );
  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify({ share: "enabled", compaction: { model: "other" }, plugin: [] }));
  const unhealthy = diagnoseOpenCode({ configDir, environment: { OPENCODE_COMPACTION_OBSERVATION_DIR: observationDirectory } });
  assert.equal(unhealthy.healthy, false);
  assert.ok(unhealthy.checks.some((item) => item.name === "compaction route" && item.level === "error"));

  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify({
    model: "fixture/model",
    provider: { fixture: { models: { model: { limit: { input: 10_000 } } } } },
    compaction: { auto: true, reserved: 20_000 },
  }));
  const incoherent = diagnoseOpenCode({ configDir, environment: { OPENCODE_COMPACTION_OBSERVATION_DIR: observationDirectory } });
  assert.equal(incoherent.healthy, false);
  assert.ok(incoherent.checks.some((item) => item.name === "context budget" && item.level === "error"));
  console.log("OK     OpenCode doctor diagnostics");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
