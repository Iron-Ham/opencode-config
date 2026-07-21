#!/usr/bin/env bun

import assert from "node:assert/strict";

import {
  candidateTools,
  candidateToolUsage,
  requiredCandidateTools,
} from "./benchmark-opencode-context-tools.mjs";

assert.deepEqual(candidateTools("text_read"), ["text_read"]);
assert.deepEqual(candidateTools("glob,text_read"), ["glob", "text_read"]);
assert.throws(
  () => candidateTools("read"),
  /subset of glob,grep,ast_grep,text_read/,
);
assert.deepEqual(
  requiredCandidateTools("text_read", ["glob", "text_read"]),
  ["text_read"],
);
assert.throws(
  () => requiredCandidateTools("text_read", ["glob"]),
  /subset of --candidate-tools/,
);
assert.deepEqual(
  candidateToolUsage([
    { type: "tool_use", part: { tool: "grep" } },
    { type: "tool_use", part: { tool: "text_read" } },
    { type: "tool_use", part: { tool: "text_read" } },
  ], ["text_read", "glob"]),
  {
    required: ["text_read", "glob"],
    counts: { glob: 0, text_read: 2 },
    missing: ["glob"],
  },
);

console.log("PASS context-tool benchmark selection safeguards");
