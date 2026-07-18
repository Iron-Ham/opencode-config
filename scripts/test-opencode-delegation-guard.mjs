#!/usr/bin/env bun

import assert from "node:assert/strict";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { createDelegationGuard } = await import(path.join(repoRoot, "opencode", "plugins", "delegation-guard.js"));
const hooks = await createDelegationGuard({ max_concurrent: 2, max_total: 3 });
const reviewPrompt = "Read-only review of this concrete diff. Do not edit or run commands. Source boundary: opencode/plugins/delegation-guard.js.";

const reservationHooks = await createDelegationGuard({ max_concurrent: 2, max_total: 3 });
await Promise.all([
  reservationHooks["tool.execute.before"]({ tool: "task", sessionID: "reservation-parent", callID: "reservation-one" }, { args: { subagent_type: "explore", prompt: "Inspect the exact source boundary." } }),
  reservationHooks["tool.execute.before"]({ tool: "task", sessionID: "reservation-parent", callID: "reservation-two" }, { args: { subagent_type: "explore", prompt: "Inspect the exact source boundary." } }),
]);
await assert.rejects(() => reservationHooks["tool.execute.before"]({ tool: "task", sessionID: "reservation-parent", callID: "reservation-three" }, { args: { subagent_type: "explore", prompt: "Inspect the exact source boundary." } }), /concurrency limit/);

async function start(callID, agent = "code_reviewer", prompt = reviewPrompt) {
  await hooks["tool.execute.before"]({ tool: "task", sessionID: "parent", callID }, { args: { subagent_type: agent, prompt } });
  await hooks["tool.execute.after"]({ tool: "task", sessionID: "parent", callID }, { output: JSON.stringify({ task_id: `child-${callID}` }) });
}

await assert.rejects(() => start("bad", "code_reviewer", "Please review this."), /exact diff/);
await assert.rejects(() => start("keyword-only", "code_reviewer", "Read-only review; do not edit. Exact diff unavailable."), /exact diff/);
await start("one");
await start("two");
await assert.rejects(() => start("three"), /concurrency limit/);
await hooks.event({ event: { type: "session.status", properties: { sessionID: "child-one", status: { type: "idle" } } } });
await start("three");
await hooks.event({ event: { type: "session.status", properties: { sessionID: "child-two", status: { type: "idle" } } } });
await hooks.event({ event: { type: "session.status", properties: { sessionID: "child-three", status: { type: "idle" } } } });
await assert.rejects(() => start("four"), /total limit/);
console.log("OK     OpenCode delegation guard");
