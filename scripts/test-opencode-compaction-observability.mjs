#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const directory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-compaction-observation-test-"));
const originalDirectory = process.env.OPENCODE_COMPACTION_OBSERVATION_DIR;

try {
  process.env.OPENCODE_COMPACTION_OBSERVATION_DIR = directory;
  const observer = await import(path.join(repoRoot, "opencode", "plugins", "compaction-observability.js"));
  assert.equal(observer.default.id, "opencode-compaction-observability");
  assert.equal(observer.testHelpers.compactionObservationDirectory(), directory);
  const hooks = await observer.testHelpers.createCompactionObservability();
  await hooks["experimental.session.compacting"]({ sessionID: "sensitive-session-id" }, { context: [] });
  await hooks["experimental.compaction.autocontinue"]({ sessionID: "sensitive-session-id" }, { enabled: true });
  const records = fs.readdirSync(directory).map((name) => JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")));
  assert.deepEqual(records.map((record) => record.event).sort(), ["autocontinue", "started"]);
  for (const record of records) {
    assert.equal(record.schema_version, 1);
    assert.equal(record.model_strategy, "active-session");
    assert.match(record.session_sha256, /^sha256:/);
    assert.doesNotMatch(JSON.stringify(record), /sensitive-session-id/);
  }
  assert.equal(fs.statSync(directory).mode & 0o777, 0o700);
  for (const name of fs.readdirSync(directory)) assert.equal(fs.statSync(path.join(directory, name)).mode & 0o777, 0o600);
  await assert.rejects(() => observer.testHelpers.createCompactionObservability({ model_strategy: "separate-model" }));
  console.log("OK     OpenCode compaction observability");
} finally {
  if (originalDirectory === undefined) delete process.env.OPENCODE_COMPACTION_OBSERVATION_DIR;
  else process.env.OPENCODE_COMPACTION_OBSERVATION_DIR = originalDirectory;
  fs.rmSync(directory, { recursive: true, force: true });
}
