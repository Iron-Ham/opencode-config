#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const corpus = JSON.parse(fs.readFileSync(
  path.join(repoRoot, "reports", "opencode-model-routing", "sanitization-preflight-corpus.json"),
  "utf8",
));
const expectedResultKeys = [
  "category",
  "confidence",
  "length",
  "line",
  "replacement_marker",
  "span",
];

assert.equal(corpus.schema_version, 1);
assert.equal(typeof corpus.purpose, "string");
assert.ok(Array.isArray(corpus.candidate_rules));
assert.ok(Array.isArray(corpus.cases));

const categories = new Set(corpus.candidate_rules.map((rule) => rule.category));
assert.equal(categories.size, corpus.candidate_rules.length);
for (const rule of corpus.candidate_rules) {
  assert.equal(rule.status, "unapproved");
}

for (const entry of corpus.cases) {
  assert.equal(typeof entry.id, "string");
  assert.equal(typeof entry.input, "string");
  assert.ok(["redact", "preserve"].includes(entry.expected.action));
  assert.equal(typeof entry.expected.review_required, "boolean");
  assert.ok(Array.isArray(entry.expected.results));
  assert.equal(entry.expected.action === "redact", entry.expected.results.length > 0);
  assert.equal(entry.expected.review_required, entry.expected.results.length > 0);

  for (const result of entry.expected.results) {
    assert.deepEqual(Object.keys(result).sort(), expectedResultKeys);
    assert.ok(categories.has(result.category));
    assert.equal(result.line, 1);
    assert.ok(Number.isInteger(result.span.start));
    assert.ok(Number.isInteger(result.span.end));
    assert.ok(result.span.start >= 0 && result.span.end <= entry.input.length);
    assert.equal(result.length, result.span.end - result.span.start);
    assert.ok(["medium", "high"].includes(result.confidence));
    assert.match(result.replacement_marker, /^\[REDACTED:[A-Z_]+\]$/);
    assert.equal(Object.hasOwn(result, "value"), false);
  }
}

console.log(`OK     ${corpus.cases.length} synthetic sanitization preflight cases`);
