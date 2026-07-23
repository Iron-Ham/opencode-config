#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-context-tools-secret-filter-"));
const sourceRoot = path.join(temporaryRoot, "source");
const fixtureRoot = path.join(temporaryRoot, "fixture");
const externalRoot = path.join(temporaryRoot, "external");

function copy(relativePath) {
  const source = path.join(repoRoot, "opencode", relativePath);
  const target = path.join(sourceRoot, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function installPluginStub() {
  const packageRoot = path.join(sourceRoot, "node_modules", "@opencode-ai", "plugin");
  fs.mkdirSync(packageRoot, { recursive: true });
  fs.writeFileSync(
    path.join(packageRoot, "package.json"),
    JSON.stringify({ type: "module", exports: "./index.js" }),
  );
  fs.writeFileSync(
    path.join(packageRoot, "index.js"),
    [
      "function schemaNode() {",
      "  const node = {};",
      "  node.describe = () => node;",
      "  node.optional = () => node;",
      "  return node;",
      "}",
      "export function tool(definition) { return definition; }",
      "tool.schema = { string: schemaNode };",
      "",
    ].join("\n"),
  );
}

try {
  for (const relativePath of [
    "context-tools-lib/runtime.ts",
    "context-tools/glob.ts",
    "context-tools/grep.ts",
    "context-tools/ast_grep.ts",
  ]) copy(relativePath);
  installPluginStub();

  fs.mkdirSync(fixtureRoot);
  fs.mkdirSync(externalRoot);
  fs.writeFileSync(path.join(fixtureRoot, ".env"), "TOKEN=DO_NOT_DISCLOSE\n");
  fs.writeFileSync(path.join(fixtureRoot, ".env.local"), "TOKEN=DO_NOT_DISCLOSE\n");
  fs.writeFileSync(path.join(fixtureRoot, ".envrc"), "TOKEN=DO_NOT_DISCLOSE\n");
  fs.mkdirSync(path.join(fixtureRoot, ".env.d"));
  fs.writeFileSync(path.join(fixtureRoot, ".env.d", "secrets"), "TOKEN=DO_NOT_DISCLOSE\n");
  fs.mkdirSync(path.join(fixtureRoot, "sample.env.example"));
  fs.writeFileSync(path.join(fixtureRoot, "sample.env.example", "secrets"), "TOKEN=DO_NOT_DISCLOSE\n");
  fs.writeFileSync(path.join(fixtureRoot, "secrets.env"), "TOKEN=DO_NOT_DISCLOSE\n");
  fs.writeFileSync(
    path.join(fixtureRoot, "secrets.env.json"),
    '{"secret":"DO_NOT_DISCLOSE"}\n',
  );
  fs.writeFileSync(path.join(fixtureRoot, ".env.example"), "TOKEN=EXAMPLE_VISIBLE\n");
  fs.writeFileSync(path.join(fixtureRoot, "source.ts"), "export const visible = true;\n");
  fs.writeFileSync(path.join(externalRoot, "secret.ts"), "export const secret = true;\n");
  fs.symlinkSync(externalRoot, path.join(fixtureRoot, "external-link"), "dir");

  const [globModule, grepModule, astGrepModule] = await Promise.all([
    import(pathToFileURL(path.join(sourceRoot, "context-tools", "glob.ts")).href),
    import(pathToFileURL(path.join(sourceRoot, "context-tools", "grep.ts")).href),
    import(pathToFileURL(path.join(sourceRoot, "context-tools", "ast_grep.ts")).href),
  ]);
  const context = { directory: fixtureRoot };

  const globOutput = await globModule.default.execute({ pattern: "**/*", path: fixtureRoot }, context);
  assert.doesNotMatch(globOutput, /^\.env$/m);
  assert.doesNotMatch(globOutput, /^\.env\.local$/m);
  assert.doesNotMatch(globOutput, /^\.envrc$/m);
  assert.doesNotMatch(globOutput, /^\.env\.d\/secrets$/m);
  assert.doesNotMatch(globOutput, /^sample\.env\.example\/secrets$/m);
  assert.doesNotMatch(globOutput, /^secrets\.env(?:\.json)?$/m);
  assert.match(globOutput, /source\.ts/);

  const secretGrepOutput = await grepModule.default.execute(
    { pattern: "DO_NOT_DISCLOSE", path: fixtureRoot },
    context,
  );
  assert.equal(secretGrepOutput, "No matches found.");
  const exampleGrepOutput = await grepModule.default.execute(
    { pattern: "EXAMPLE_VISIBLE", path: fixtureRoot },
    context,
  );
  assert.match(exampleGrepOutput, /\.env\.example/);

  const astOutput = await astGrepModule.default.execute(
    { language: "json", pattern: '{ "secret": "$VALUE" }', path: fixtureRoot },
    context,
  );
  assert.equal(astOutput, "No structural matches found.");

  for (const searchPath of [externalRoot, path.join(fixtureRoot, "external-link")]) {
    for (const searchTool of [globModule.default, grepModule.default, astGrepModule.default]) {
      const result = await searchTool.execute(
        searchTool === grepModule.default
          ? { pattern: "secret", path: searchPath }
          : searchTool === astGrepModule.default
          ? { language: "typescript", pattern: "const $NAME = $VALUE", path: searchPath }
          : { pattern: "**/*", path: searchPath },
        context,
      );
      assert.equal(result, "Search path must stay within the active workspace.");
    }
  }

  console.log("OK     OpenCode context tools filter protected environment files");
} finally {
  fs.rmSync(temporaryRoot, { recursive: true, force: true });
}
