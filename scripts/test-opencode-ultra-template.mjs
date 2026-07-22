#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const sourceCommand = path.join(repoRoot, "opencode", "commands", "ultra.md");
const template = fs.readFileSync(sourceCommand, "utf8");
const templateMarker = "Apply this stateless high-effort template to the current request only.";
const goalToolNames = [
  "get_goal",
  "get_goal_history",
  "create_goal",
  "set_goal",
  "update_goal_objective",
  "update_goal",
  "update_goal_status",
  "clear_goal",
  "record_goal_progress",
  "record_goal_failure",
];
const goalContinuationText = [
  "Continue working toward the active thread goal.",
  "<objective>",
  "Continuation behavior:",
  "Tokens used:",
  "Token budget:",
  "Progress visibility:",
  "Completion audit:",
  "update_goal",
];
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-ultra-template-test-"));
const configDir = path.join(testRoot, "config");
const xdgConfigHome = path.join(testRoot, "xdg-config");
const stateDir = path.join(testRoot, "state");
const dataDir = path.join(testRoot, "data");
const cacheDir = path.join(testRoot, "cache");
const commandDir = path.join(configDir, "commands");
const workDir = path.join(testRoot, "workspace");
const payloads = [];

function count(text, value) {
  return text.split(value).length - 1;
}

function parseJsonEvents(output) {
  return output.split(/\r?\n/u).filter(Boolean).map((line) => JSON.parse(line));
}

async function runOpenCode(args) {
  const process = Bun.spawn(["opencode", "run", "--pure", "--dir", workDir, "--format", "json", ...args], {
    cwd: workDir,
    env: {
      ...processEnv,
      OPENCODE_CONFIG_DIR: configDir,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_STATE_HOME: stateDir,
      XDG_DATA_HOME: dataDir,
      XDG_CACHE_HOME: cacheDir,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  assert.equal(exitCode, 0, `${stderr}\n${stdout}\n${JSON.stringify(payloads)}`);
  return { events: parseJsonEvents(stdout), stderr };
}

const processEnv = { ...process.env };
let server;
try {
  fs.mkdirSync(commandDir, { recursive: true });
  fs.mkdirSync(workDir, { recursive: true });
  fs.copyFileSync(sourceCommand, path.join(commandDir, "ultra.md"));
  assert.ok(fs.existsSync(path.join(commandDir, "ultra.md")));
  assert.ok(Buffer.byteLength(template, "utf8") <= 2500);

  server = Bun.serve({
    port: 0,
    async fetch(request) {
      if (request.method !== "POST" || !request.url.endsWith("/v1/chat/completions")) {
        return new Response("not found", { status: 404 });
      }
      payloads.push(await request.json());
      const body = [
        `data: ${JSON.stringify({
          id: `fixture-${payloads.length}`,
          object: "chat.completion.chunk",
          created: 1,
          model: "ultra-fixture",
          choices: [{ index: 0, delta: { role: "assistant", content: "fixture response" }, finish_reason: null }],
        })}\n\n`,
        `data: ${JSON.stringify({
          id: `fixture-${payloads.length}`,
          object: "chat.completion.chunk",
          created: 1,
          model: "ultra-fixture",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        })}\n\n`,
        "data: [DONE]\n\n",
      ].join("");
      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
        },
      });
    },
  });

  fs.writeFileSync(path.join(configDir, "opencode.json"), JSON.stringify({
    "$schema": "https://opencode.ai/config.json",
    model: "openai/ultra-fixture",
    default_agent: "build",
    enabled_providers: ["openai"],
    disabled_providers: [],
    provider: {
      openai: {
        name: "Fixture OpenAI-compatible",
        npm: "@ai-sdk/openai-compatible",
        options: {
          baseURL: `http://127.0.0.1:${server.port}/v1`,
          apiKey: "fixture-key",
        },
        models: {
          "ultra-fixture": {
            name: "Fixture",
            limit: { context: 32000, input: 32000, output: 1000 },
          },
        },
      },
    },
    permission: {
      "*": "allow",
      external_directory: { "*": "allow" },
    },
  }));
  const ordinary = await runOpenCode(["ordinary fixture task"]);
  assert.equal(payloads.length, 1);
  assert.equal(count(JSON.stringify(payloads[0]), templateMarker), 0);

  const ultra = await runOpenCode(["--command", "ultra", "fixture task"]);
  assert.equal(payloads.length, 2);
  const ultraPayload = JSON.stringify(payloads[1]);
  assert.equal(count(ultraPayload, templateMarker), 1);
  assert.equal(count(ultraPayload, "fixture task"), 1);

  const sessionID = [...ultra.events, ...ordinary.events]
    .map((event) => event.sessionID ?? event.properties?.sessionID)
    .find((value) => typeof value === "string");
  assert.equal(typeof sessionID, "string");
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(payloads.length, 2);

  await runOpenCode(["--session", sessionID, "follow-up request"]);
  assert.equal(payloads.length, 3);
  const followUpPayload = JSON.stringify(payloads[2]);
  assert.equal(count(followUpPayload, templateMarker), 1);
  assert.equal(count(followUpPayload, "fixture task"), 1);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(payloads.length, 3);

  for (const payload of payloads) {
    const serialized = JSON.stringify(payload);
    for (const goalToolName of goalToolNames) assert.equal(serialized.includes(goalToolName), false);
    for (const continuationText of goalContinuationText) assert.equal(serialized.includes(continuationText), false);
  }

  console.log("OK     stateless Ultra command template payload and lifecycle evidence");
} finally {
  server?.stop();
  fs.rmSync(testRoot, { recursive: true, force: true });
}
