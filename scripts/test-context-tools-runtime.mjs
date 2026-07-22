#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MAX_MATCH_TEXT_BYTES,
  MAX_OUTPUT_BYTES,
  MAX_RESULTS,
  createPathGlobMatcher,
  ignoreArguments,
  isPathWithinDirectory,
  isBinary,
  positiveInteger,
  ripgrepTypeFilterArguments,
  runCommandLines,
  resolvePath,
  sortedDirectoryEntries,
  truncateMatchText,
  utf8Prefix,
} from "../opencode/context-tools-lib/runtime.ts";

assert.equal(positiveInteger(undefined, 10, 20), 10);
assert.equal(positiveInteger(0, 10, 20), 10);
assert.equal(positiveInteger(21, 10, 20), 20);
assert.equal(positiveInteger(15, 10, 20), 15);
assert.equal(MAX_RESULTS, 50);
assert.equal(resolvePath("src", "/tmp/project"), "/tmp/project/src");
assert.equal(isPathWithinDirectory("/tmp/project/src", "/tmp/project"), true);
assert.equal(isPathWithinDirectory("/tmp/other", "/tmp/project"), false);
assert.deepEqual(ignoreArguments(), ["--hidden", "--glob", "!.git", "--glob", "!.git/**"]);

const matchesTypeScript = createPathGlobMatcher("*.ts");
assert.equal(matchesTypeScript("nested/file.ts"), true);
assert.equal(matchesTypeScript("nested/file.js"), false);
assert.equal(createPathGlobMatcher("!*.env")("nested/.env"), false);
assert.equal(createPathGlobMatcher("!*.env")("nested/file.txt"), true);
assert.deepEqual(ripgrepTypeFilterArguments("*.ts"), [
  "--type-add",
  "opencodecontext:*.ts",
  "--type",
  "opencodecontext",
]);
assert.deepEqual(ripgrepTypeFilterArguments("nested/*.ts"), []);
assert.deepEqual(ripgrepTypeFilterArguments("!*.env"), []);

const truncatedMatch = truncateMatchText("😀".repeat(MAX_MATCH_TEXT_BYTES));
assert.ok(Buffer.byteLength(truncatedMatch, "utf8") <= MAX_MATCH_TEXT_BYTES);
assert.match(truncatedMatch, /line truncated/);
assert.equal(truncateMatchText("line\r\n"), "line");
const unicodePrefix = "😀".repeat(MAX_MATCH_TEXT_BYTES);
const lateMatch = truncateMatchText(
  `${unicodePrefix}MARKER`,
  Buffer.byteLength(unicodePrefix, "utf8"),
);
assert.ok(Buffer.byteLength(lateMatch, "utf8") <= MAX_MATCH_TEXT_BYTES);
assert.match(lateMatch, /^\[\.\.\.\]/);
assert.match(lateMatch, /MARKER$/);

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

const received = [];
const bounded = await runCommandLines(
  [process.execPath, "-e", "for (let index = 0; index < 1_000; index += 1) console.log(index)"],
  process.cwd(),
  (line) => {
    received.push(line);
    return received.length < 3;
  },
);
assert.deepEqual(received, ["0", "1", "2"]);
assert.equal(bounded.stopped, true);

console.log("PASS context-efficient tool runtime helpers");
