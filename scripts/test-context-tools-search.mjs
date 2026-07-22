#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { MAX_MATCH_TEXT_BYTES } from "../opencode/context-tools-lib/runtime.ts";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "context-tools-search-"));
const repoRoot = path.resolve(import.meta.dir, "..");

function installPluginStub(moduleRoot) {
  const pluginRoot = path.join(moduleRoot, "node_modules", "@opencode-ai", "plugin");
  fs.mkdirSync(pluginRoot, { recursive: true });
  fs.writeFileSync(
    path.join(pluginRoot, "package.json"),
    JSON.stringify({ type: "module", exports: "./index.js" }),
  );
  fs.writeFileSync(
    path.join(pluginRoot, "index.js"),
    [
      "const chain = new Proxy({}, { get: () => () => chain });",
      "export const tool = Object.assign((definition) => definition, {",
      "  schema: { string: () => chain, number: () => chain },",
      "});",
    ].join("\n"),
  );
}

async function loadTool(moduleRoot, name) {
  return (await import(pathToFileURL(path.join(moduleRoot, "context-tools", name)).href)).default;
}

try {
  const moduleRoot = path.join(root, "modules");
  fs.cpSync(
    path.join(repoRoot, "opencode", "context-tools"),
    path.join(moduleRoot, "context-tools"),
    { recursive: true },
  );
  fs.cpSync(
    path.join(repoRoot, "opencode", "context-tools-lib"),
    path.join(moduleRoot, "context-tools-lib"),
    { recursive: true },
  );
  installPluginStub(moduleRoot);

  const [glob, grep] = await Promise.all([
    loadTool(moduleRoot, "glob.ts"),
    loadTool(moduleRoot, "grep.ts"),
  ]);
  const workspace = path.join(root, "workspace");
  fs.mkdirSync(workspace);
  fs.writeFileSync(path.join(workspace, ".gitignore"), ".env\nprivate/\n");
  fs.writeFileSync(path.join(workspace, ".env"), "TOP_SECRET=hidden\n");
  fs.writeFileSync(path.join(workspace, "visible.env"), "VISIBLE=value\n");
  fs.mkdirSync(path.join(workspace, ".git"));
  fs.writeFileSync(path.join(workspace, ".git", "config"), "GIT_SECRET=hidden\n");
  fs.mkdirSync(path.join(workspace, "private"));
  fs.writeFileSync(path.join(workspace, "private", "secret.txt"), "PRIVATE_SECRET=hidden\n");
  fs.mkdirSync(path.join(workspace, "nested"));
  fs.writeFileSync(path.join(workspace, "nested", "included.ts"), "NESTED_MATCH\n");
  const longPrefix = "x".repeat(MAX_MATCH_TEXT_BYTES * 2);
  fs.writeFileSync(
    path.join(workspace, "long.txt"),
    `${longPrefix} MARKER nearby-context ${"y".repeat(MAX_MATCH_TEXT_BYTES * 4)}\n`,
  );

  const context = { directory: workspace };
  assert.equal(
    await glob.execute({ pattern: "*.env", path: "." }, context),
    "visible.env",
  );
  assert.equal(
    await grep.execute({ pattern: "TOP_SECRET", path: ".", include: "*.env" }, context),
    "No matches found.",
  );
  assert.equal(
    await grep.execute({ pattern: "TOP_SECRET", path: ".env" }, context),
    "No matches found.",
  );
  assert.equal(
    await grep.execute({ pattern: "VISIBLE", path: "visible.env" }, context),
    "visible.env:1:1: VISIBLE=value",
  );
  assert.equal(
    await glob.execute({ pattern: ".git", path: "." }, context),
    "No files found.",
  );
  assert.equal(
    await grep.execute({ pattern: "gitdir", path: ".", include: ".git" }, context),
    "No matches found.",
  );
  assert.equal(
    await glob.execute({ pattern: "*", path: ".git" }, context),
    "No files found.",
  );
  assert.equal(
    await grep.execute({ pattern: "GIT_SECRET", path: ".git" }, context),
    "No matches found.",
  );
  assert.equal(
    await glob.execute({ pattern: "*", path: "private" }, context),
    "No files found.",
  );
  assert.equal(
    await grep.execute({ pattern: "PRIVATE_SECRET", path: "private" }, context),
    "No matches found.",
  );
  assert.match(
    await grep.execute({ pattern: "NESTED_MATCH", path: ".", include: "*.ts" }, context),
    /^nested\/included\.ts:1:1: NESTED_MATCH$/m,
  );
  assert.equal(
    await glob.execute({ pattern: "nested/*.ts", path: "." }, context),
    "nested/included.ts",
  );
  assert.match(
    await grep.execute({ pattern: "NESTED_MATCH", path: ".", include: "nested/*.ts" }, context),
    /^nested\/included\.ts:1:1: NESTED_MATCH$/m,
  );

  const longMatch = await grep.execute(
    { pattern: "MARKER", path: ".", include: "long.txt" },
    context,
  );
  assert.match(longMatch, /MARKER nearby-context/);
  assert.match(longMatch, /line truncated/);
  assert.ok(Buffer.byteLength(longMatch, "utf8") <= MAX_MATCH_TEXT_BYTES + 64);

  console.log("PASS context-efficient search tools");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
