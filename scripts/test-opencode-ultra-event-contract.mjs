#!/usr/bin/env bun
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "reports/opencode-model-routing/ultra-event-contract-fixtures.json"), "utf8"));
const keys = ["causal_parent_id","event_id","event_type","goal_id","metadata","observed_at","reason_code","schema_version","session_id"];
const types = new Set(["goal_created","goal_resumed","goal_checkpointed","child_started","child_completed","child_blocked","validation_passed","validation_failed","provider_failure","no_progress_stop","final_handoff"]);
const validate = (event, prior = new Set()) => { assert.deepEqual(Object.keys(event).sort(), keys); assert.equal(event.schema_version, 1); assert.ok(types.has(event.event_type)); assert.ok(Number.isFinite(Date.parse(event.observed_at))); if (event.causal_parent_id !== null) assert.ok(prior.has(event.causal_parent_id)); for (const [key, value] of Object.entries(event.metadata)) { assert.ok(["completion_evidence_artifact_id","status","retry_count","child_session_id"].includes(key)); assert.equal(typeof value === "string" || Number.isSafeInteger(value), true); assert.doesNotMatch(String(value), /Authorization:|api[_-]?key|\/|diff|prompt|output/i); } };
for (const trace of fixture.traces) { const seen = new Set(); for (const event of trace) { validate(event, seen); assert.equal(seen.has(event.event_id), false); seen.add(event.event_id); } }
for (const forbidden of fixture.forbidden) { const unsafe = structuredClone(fixture.traces[0][0]); unsafe.metadata = { unsafe: forbidden }; assert.throws(() => validate(unsafe)); }
const segments = fixture.approved_metadata.repo_reference.split("/"); assert.ok(segments.every((segment) => segment !== "." && segment !== "..")); assert.match(fixture.approved_metadata.repo_reference, /^(?:[A-Za-z0-9_-]+\/)+[A-Za-z0-9._-]+$/);
console.log("OK     3 synthetic Ultra event traces and redaction corpus");
