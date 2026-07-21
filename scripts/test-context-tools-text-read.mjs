#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { MAX_OUTPUT_BYTES } from "../opencode/context-tools-lib/runtime.ts";
import {
  MAX_TEXT_READ_LINE_CHARACTERS,
  executeTextRead,
} from "../opencode/context-tools-lib/text-read.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-tools-text-read-"));
const workspace = path.join(root, "workspace");
const outside = path.join(root, "outside");
fs.mkdirSync(workspace);
fs.mkdirSync(outside);

function createContext(directory = workspace, ask = async () => undefined) {
  return {
    directory,
    worktree: directory,
    ask,
  };
}

try {
  const textPath = path.join(workspace, "text.txt");
  fs.writeFileSync(textPath, "one\r\ntwo\nthree\rfour\n", "utf8");
  const textCalls = [];
  const text = await executeTextRead(
    { filePath: "text.txt", offset: 2, limit: 2 },
    createContext(workspace, async (request) => {
      textCalls.push(request);
    }),
  );
  assert.match(text, /^2: two\n3: three/m);
  assert.match(text, /offset=4 to continue if more remains/);
  assert.deepEqual(textCalls.map((request) => request.permission), ["read"]);
  assert.equal(textCalls[0].patterns[0], fs.realpathSync(textPath));

  const spacedPath = path.join(workspace, " spaced.txt ");
  fs.writeFileSync(spacedPath, "spaced\n", "utf8");
  const spaced = await executeTextRead({ filePath: " spaced.txt " }, createContext());
  assert.match(spaced, /^1: spaced$/m);

  const unterminatedPath = path.join(workspace, "unterminated.txt");
  fs.writeFileSync(unterminatedPath, "last line", "utf8");
  const unterminated = await executeTextRead(
    { filePath: unterminatedPath },
    createContext(),
  );
  assert.match(unterminated, /^1: last line$/m);

  const longLinePath = path.join(workspace, "long.txt");
  fs.writeFileSync(longLinePath, `${"x".repeat(10_000)}\nnext\n`, "utf8");
  const longLine = await executeTextRead(
    { filePath: longLinePath, limit: 1 },
    createContext(),
  );
  assert.match(longLine, /line truncated/);
  assert.match(
    longLine,
    new RegExp(`truncated to ${MAX_TEXT_READ_LINE_CHARACTERS} characters`),
  );

  const cappedPath = path.join(workspace, "capped.txt");
  fs.writeFileSync(
    cappedPath,
    `${Array.from({ length: 20 }, () => "😀".repeat(1_000)).join("\n")}\n`,
    "utf8",
  );
  const capped = await executeTextRead(
    { filePath: cappedPath, limit: 20 },
    createContext(),
  );
  assert.ok(Buffer.byteLength(capped, "utf8") <= MAX_OUTPUT_BYTES);
  assert.match(capped, /Output capped by byte budget/);

  const directoryPath = path.join(workspace, "directory");
  fs.mkdirSync(directoryPath);
  fs.writeFileSync(path.join(directoryPath, "z.txt"), "z");
  fs.writeFileSync(path.join(directoryPath, "a.txt"), "a");
  fs.mkdirSync(path.join(directoryPath, "nested"));
  const listing = await executeTextRead(
    { filePath: directoryPath, offset: 2, limit: 1 },
    createContext(),
  );
  assert.match(listing, /^2: nested\/$/m);
  assert.match(listing, /offset=3 to continue/);

  const pdfPath = path.join(workspace, "sample.pdf");
  fs.writeFileSync(pdfPath, Buffer.from("%PDF-1.7\n"));
  const pdf = await executeTextRead({ filePath: pdfPath }, createContext());
  assert.match(pdf, /Use native Read for PDF attachments/);

  const pngPath = path.join(workspace, "sample.png");
  fs.writeFileSync(
    pngPath,
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  );
  const png = await executeTextRead({ filePath: pngPath }, createContext());
  assert.match(png, /Use native Read for image attachments/);

  const binaryPath = path.join(workspace, "sample.bin");
  fs.writeFileSync(binaryPath, Buffer.from([0x61, 0x00, 0x62]));
  const binary = await executeTextRead({ filePath: binaryPath }, createContext());
  assert.match(binary, /Use native Read for non-text content/);

  const invalidUtf8Path = path.join(workspace, "invalid-utf8.bin");
  fs.writeFileSync(invalidUtf8Path, Buffer.from([0x61, 0xff]));
  const invalidUtf8 = await executeTextRead(
    { filePath: invalidUtf8Path },
    createContext(),
  );
  assert.match(invalidUtf8, /Use native Read for non-text content/);

  const incompleteUtf8Path = path.join(workspace, "incomplete-utf8.bin");
  fs.writeFileSync(incompleteUtf8Path, Buffer.from([0xc2]));
  const incompleteUtf8 = await executeTextRead(
    { filePath: incompleteUtf8Path },
    createContext(),
  );
  assert.match(incompleteUtf8, /Use native Read for non-text content/);

  if (process.platform !== "win32") {
    const fifoPath = path.join(workspace, "queue.fifo");
    const fifo = Bun.spawnSync(["mkfifo", fifoPath]);
    assert.equal(fifo.exitCode, 0, fifo.stderr.toString());
    const special = await executeTextRead({ filePath: fifoPath }, createContext());
    assert.match(special, /cannot safely read this special file/i);
  }

  const externalPath = path.join(outside, "external.txt");
  const linkedPath = path.join(workspace, "external-link.txt");
  fs.writeFileSync(externalPath, "external\n", "utf8");
  fs.symlinkSync(externalPath, linkedPath);
  const externalCalls = [];
  const external = await executeTextRead(
    { filePath: linkedPath },
    createContext(workspace, async (request) => {
      externalCalls.push(request);
    }),
  );
  assert.match(external, /^1: external$/m);
  assert.deepEqual(
    externalCalls.map((request) => request.permission),
    ["external_directory", "read"],
  );
  assert.equal(externalCalls[1].patterns[0], fs.realpathSync(externalPath));

  const deniedPath = path.join(workspace, ".env");
  fs.writeFileSync(deniedPath, "SECRET=value\n", "utf8");
  await assert.rejects(
    () => executeTextRead(
      { filePath: deniedPath },
      createContext(workspace, async (request) => {
        if (request.permission === "read") throw new Error("read denied");
      }),
    ),
    /read denied/,
  );

  const wildcardPath = path.join(workspace, "literal*.txt");
  fs.writeFileSync(wildcardPath, "literal\n", "utf8");
  let permissionCalls = 0;
  await assert.rejects(
    () => executeTextRead(
      { filePath: wildcardPath },
      createContext(workspace, async () => {
        permissionCalls += 1;
      }),
    ),
    /Cannot request a safe read permission/,
  );
  assert.equal(permissionCalls, 0);

  const outOfRange = await executeTextRead(
    { filePath: textPath, offset: 10 },
    createContext(),
  );
  assert.match(outOfRange, /Offset 10 is out of range for this file \(4 lines\)/);

  console.log("PASS context-efficient text read");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
