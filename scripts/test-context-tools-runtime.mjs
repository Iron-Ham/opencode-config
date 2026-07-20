#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_OUTPUT_BYTES,
  MAX_RESULTS,
  isBinary,
  positiveInteger,
  resolvePath,
  sortedDirectoryEntries,
  utf8Prefix,
} from "../opencode/context-tools-lib/runtime.ts";

assert.equal(positiveInteger(undefined, 10, 20), 10);
assert.equal(positiveInteger(0, 10, 20), 10);
assert.equal(positiveInteger(21, 10, 20), 20);
assert.equal(positiveInteger(15, 10, 20), 15);
assert.equal(MAX_RESULTS, 50);
assert.equal(resolvePath("src", "/tmp/project"), "/tmp/project/src");

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "context-tools-runtime-"));
try {
  fs.mkdirSync(path.join(directory, "nested"));
  fs.writeFileSync(path.join(directory, "z.txt"), "z");
  fs.writeFileSync(path.join(directory, "a.txt"), "a");
  assert.deepEqual(sortedDirectoryEntries(directory), ["a.txt", "nested/", "z.txt"]);
  assert.equal(isBinary(Buffer.from("text")), false);
  assert.equal(isBinary(Buffer.from([0x61, 0, 0x62])), true);
  const truncated = utf8Prefix("x".repeat(MAX_OUTPUT_BYTES + 10));
  assert.equal(truncated.truncated, true);
  assert.ok(Buffer.byteLength(truncated.value, "utf8") <= MAX_OUTPUT_BYTES);
  assert.match(truncated.value, /Output truncated/);
} finally {
  fs.rmSync(directory, { recursive: true, force: true });
}

console.log("PASS context-efficient tool runtime helpers");
