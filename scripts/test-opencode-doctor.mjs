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
    compaction: { auto: true, reserved: 20_000 },
    plugin: [
      "./plugins/goal-mode.js",
      "./plugins/goal-workflow-guard.js",
      ["./plugins/compaction-observability.js", { model_strategy: "active-session" }],
      ["./plugins/delegation-guard.js", { max_concurrent: 4, max_total: 8 }],
    ],
    metadata: { api_token: "doctor-fixture-sensitive-value" },
  }));
  fs.writeFileSync(path.join(configDir, "model-routing.config.local.json"), JSON.stringify({ advisor_enabled: false }), { mode: 0o600 });
  fs.writeFileSync(path.join(observationDirectory, "record.json"), JSON.stringify({ schema_version: 1, event: "started", observed_at: "2026-07-18T00:00:00.000Z", model_strategy: "active-session", session_sha256: `sha256:${"a".repeat(64)}` }), { mode: 0o600 });
  const { diagnoseOpenCode } = await import(path.join(repoRoot, "scripts", "opencode-doctor.mjs"));
  const healthy = diagnoseOpenCode({ configDir, environment: { OPENCODE_COMPACTION_OBSERVATION_DIR: observationDirectory } });
  assert.equal(healthy.healthy, true);
  assert.equal(healthy.checks.some((item) => item.level === "error"), false);
  assert.doesNotMatch(JSON.stringify(healthy), /doctor-fixture-sensitive-value/);
  assert.deepEqual(
    healthy.checks
      .filter((item) => [
        "plugin ./plugins/goal-mode.js",
        "plugin ./plugins/goal-workflow-guard.js",
        "compaction observer strategy",
        "delegation limits",
      ].includes(item.name))
      .map((item) => [item.name, item.level]),
    [
      ["plugin ./plugins/goal-mode.js", "ok"],
      ["plugin ./plugins/goal-workflow-guard.js", "ok"],
      ["compaction observer strategy", "ok"],
      ["delegation limits", "ok"],
    ],
  );
  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify({ share: "enabled", compaction: { model: "other" }, plugin: [] }));
  const unhealthy = diagnoseOpenCode({ configDir, environment: { OPENCODE_COMPACTION_OBSERVATION_DIR: observationDirectory } });
  assert.equal(unhealthy.healthy, false);
  assert.ok(unhealthy.checks.some((item) => item.name === "compaction route" && item.level === "error"));
  console.log("OK     OpenCode doctor diagnostics");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
