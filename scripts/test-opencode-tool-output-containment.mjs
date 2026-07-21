#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-tool-output-test-"));
const originalDataHome = process.env.XDG_DATA_HOME;

try {
  process.env.XDG_DATA_HOME = path.join(root, "data");
  const containment = await import(
    path.join(repoRoot, "opencode", "plugins", "tool-output-containment.js"),
  );
  assert.equal(containment.default.id, "claude-config-tool-output-containment");
  assert.deepEqual(containment.testHelpers.normalizeBounds({ max_lines: 3, max_bytes: 160 }), {
    maxLines: 3,
    maxBytes: 160,
  });
  assert.deepEqual(containment.testHelpers.normalizeBounds({ max_lines: 0, max_bytes: 0 }), {
    maxLines: 300,
    maxBytes: 16_384,
  });

  let configRequests = 0;
  const hooks = await containment.testHelpers.createToolOutputContainment({
    directory: root,
    client: {
      config: {
        get: async (request) => {
          configRequests += 1;
          assert.deepEqual(request, { query: { directory: root } });
          return { data: { tool_output: { max_lines: 3, max_bytes: 160 } } };
        },
      },
    },
  });

  const fullOutput = Array.from({ length: 10 }, (_, index) => `line ${index}: ${"x".repeat(40)}`).join("\n");
  const shellOutput = { title: "shell", output: fullOutput, metadata: { exit: 0 } };
  await hooks["tool.execute.after"](
    { tool: "bash", sessionID: "fixture", callID: "shell-1", args: {} },
    shellOutput,
  );
  assert.ok(Buffer.byteLength(shellOutput.output, "utf8") <= 160);
  assert.ok(shellOutput.output.split("\n").length <= 3);
  assert.match(shellOutput.output, /\[truncated/);
  assert.equal(shellOutput.metadata.exit, 0);
  assert.deepEqual(shellOutput.metadata.managedToolOutput, {
    truncated: true,
    maxLines: 3,
    maxBytes: 160,
    originalLines: 10,
    originalBytes: Buffer.byteLength(fullOutput, "utf8"),
  });

  const artifactDirectory = containment.testHelpers.toolOutputDirectory();
  const managedArtifacts = fs.readdirSync(artifactDirectory);
  assert.equal(managedArtifacts.length, 1);
  const managedArtifact = path.join(artifactDirectory, managedArtifacts[0]);
  assert.equal(fs.readFileSync(managedArtifact, "utf8"), fullOutput);
  assert.equal(fs.statSync(artifactDirectory).mode & 0o777, 0o700);
  assert.equal(fs.statSync(managedArtifact).mode & 0o777, 0o600);

  const secondShellOutput = { title: "shell", output: fullOutput, metadata: {} };
  await hooks["tool.execute.after"](
    { tool: "bash", sessionID: "fixture", callID: "shell-2", args: {} },
    secondShellOutput,
  );
  assert.equal(configRequests, 1);

  const ordinaryOutput = { title: "read", output: fullOutput, metadata: {} };
  await hooks["tool.execute.after"](
    { tool: "read", sessionID: "fixture", callID: "read-1", args: {} },
    ordinaryOutput,
  );
  assert.equal(ordinaryOutput.output, fullOutput);
  assert.deepEqual(ordinaryOutput.metadata, {});

  const nativeArtifact = path.join(root, "native artifact.txt");
  fs.writeFileSync(nativeArtifact, "native full output\n", { mode: 0o600 });
  const nativePreview = `${fullOutput}\nFull output saved to: ${nativeArtifact}`;
  const nativeOutput = { title: "shell", output: nativePreview, metadata: {} };
  const artifactsBeforeNativePreview = fs.readdirSync(artifactDirectory).length;
  await hooks["tool.execute.after"](
    { tool: "bash", sessionID: "fixture", callID: "shell-native", args: {} },
    nativeOutput,
  );
  assert.match(nativeOutput.output, new RegExp(nativeArtifact.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(fs.readdirSync(artifactDirectory).length, artifactsBeforeNativePreview);

  const fallbackHooks = await containment.testHelpers.createToolOutputContainment({
    directory: root,
    client: { config: { get: async () => { throw new Error("config unavailable"); } } },
  });
  const fallbackOutput = { title: "shell", output: "x".repeat(20_000), metadata: {} };
  await fallbackHooks["tool.execute.after"](
    { tool: "bash", sessionID: "fixture", callID: "shell-fallback", args: {} },
    fallbackOutput,
  );
  assert.ok(Buffer.byteLength(fallbackOutput.output, "utf8") <= 16_384);
  assert.ok(fallbackOutput.output.split("\n").length <= 300);

  console.log("OK     OpenCode shell tool-output containment");
} finally {
  if (originalDataHome === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = originalDataHome;
  fs.rmSync(root, { recursive: true, force: true });
}
