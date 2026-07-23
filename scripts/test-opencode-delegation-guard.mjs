#!/usr/bin/env bun

import assert from "node:assert/strict";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { testHelpers } = await import(path.join(repoRoot, "opencode", "plugins", "delegation-guard.js"));
const { createDelegationGuard } = testHelpers;
const hooks = await createDelegationGuard({ max_concurrent: 2, max_total: 3 });
const reviewPrompt = "Read-only review of this concrete diff. Do not edit or run commands. Source boundary: opencode/plugins/delegation-guard.js.";
const implementationPrompt = [
  "Implement the requested bounded change.",
  "Source boundary: `src/feature.ts`, `src/feature.test.ts`.",
  "Acceptance criteria: the focused behavior is covered by the supplied test.",
  "Deterministic validation command: `bun test src/feature.test.ts`.",
].join("\n");
const customCliImplementationPrompt = [
  "Implement the requested bounded change.",
  "Source boundary: `Sources/Feature.swift`, `Tests/FeatureTests.swift`.",
  "Acceptance criteria: the native feature behavior is covered by the supplied test.",
  "Deterministic validation command: `./tools/buildctl test feature`.",
].join("\n");

const implementationHooks = await createDelegationGuard({ max_concurrent: 1, max_total: 1 });
await assert.rejects(
  () => implementationHooks["tool.execute.before"](
    { tool: "task", sessionID: "implementation-parent", callID: "missing-contract" },
    { args: { subagent_type: "luna_implementer", prompt: "Implement this change." } },
  ),
  /source boundary, acceptance criteria, and deterministic validation command/,
);
await implementationHooks["tool.execute.before"](
  { tool: "task", sessionID: "implementation-parent", callID: "complete-contract" },
  { args: { subagent_type: "luna_implementer", prompt: implementationPrompt } },
);
await implementationHooks["tool.execute.after"](
  { tool: "task", sessionID: "implementation-parent", callID: "complete-contract" },
  { output: JSON.stringify({ task_id: "implementation-child" }) },
);

const customCliImplementationHooks = await createDelegationGuard({ max_concurrent: 1, max_total: 1 });
await customCliImplementationHooks["tool.execute.before"](
  { tool: "task", sessionID: "custom-cli-parent", callID: "custom-cli-contract" },
  { args: { subagent_type: "luna_implementer", prompt: customCliImplementationPrompt } },
);
await customCliImplementationHooks["tool.execute.after"](
  { tool: "task", sessionID: "custom-cli-parent", callID: "custom-cli-contract" },
  { output: JSON.stringify({ task_id: "custom-cli-child" }) },
);

const reservationHooks = await createDelegationGuard({ max_concurrent: 2, max_total: 3 });
await Promise.all([
  reservationHooks["tool.execute.before"]({ tool: "task", sessionID: "reservation-parent", callID: "reservation-one" }, { args: { subagent_type: "explore", prompt: "Inspect the exact source boundary." } }),
  reservationHooks["tool.execute.before"]({ tool: "task", sessionID: "reservation-parent", callID: "reservation-two" }, { args: { subagent_type: "explore", prompt: "Inspect the exact source boundary." } }),
]);
await assert.rejects(() => reservationHooks["tool.execute.before"]({ tool: "task", sessionID: "reservation-parent", callID: "reservation-three" }, { args: { subagent_type: "explore", prompt: "Inspect the exact source boundary." } }), /concurrency limit/);

const defaultHooks = await createDelegationGuard();
async function startDefault(callID) {
  await defaultHooks["tool.execute.before"]({ tool: "task", sessionID: "default-parent", callID }, { args: { subagent_type: "explore", prompt: "Inspect the exact source boundary." } });
  await defaultHooks["tool.execute.after"]({ tool: "task", sessionID: "default-parent", callID }, { output: JSON.stringify({ task_id: `default-child-${callID}` }) });
}
for (let index = 1; index <= 10; index += 1) await startDefault(`concurrent-${index}`);
await assert.rejects(() => startDefault("concurrent-eleventh"), /concurrency limit/);
for (let index = 1; index <= 10; index += 1) {
  await defaultHooks.event({ event: { type: "session.status", properties: { sessionID: `default-child-concurrent-${index}`, status: { type: "idle" } } } });
}
for (let index = 1; index <= 10; index += 1) {
  await startDefault(`total-${index}`);
  await defaultHooks.event({ event: { type: "session.status", properties: { sessionID: `default-child-total-${index}`, status: { type: "idle" } } } });
}
await assert.rejects(() => startDefault("total-twenty-first"), /total limit/);

const idleEventHooks = await createDelegationGuard({ max_concurrent: 1, max_total: 2 });
async function startIdleEvent(callID) {
  await idleEventHooks["tool.execute.before"]({ tool: "task", sessionID: "idle-event-parent", callID }, { args: { subagent_type: "explore", prompt: "Inspect the exact source boundary." } });
  await idleEventHooks["tool.execute.after"]({ tool: "task", sessionID: "idle-event-parent", callID }, { output: JSON.stringify({ task_id: `idle-event-child-${callID}` }) });
}
await startIdleEvent("one");
await idleEventHooks.event({ event: { type: "session.idle", properties: { sessionID: "idle-event-child-one" } } });
await startIdleEvent("two");

const deletedRootHooks = await createDelegationGuard();
for (let index = 1; index <= 1000; index += 1) {
  await deletedRootHooks["tool.execute.before"]({ tool: "task", sessionID: `deleted-root-${index}`, callID: `deleted-call-${index}` }, { args: { subagent_type: "explore", prompt: "Inspect the exact source boundary." } });
}
for (let index = 1; index <= 1000; index += 1) {
  await deletedRootHooks.event({ event: { type: "session.deleted", properties: { sessionID: `deleted-root-${index}` } } });
}
await deletedRootHooks["tool.execute.before"]({ tool: "task", sessionID: "deleted-root-fresh", callID: "deleted-call-fresh" }, { args: { subagent_type: "explore", prompt: "Inspect the exact source boundary." } });

async function start(callID, agent = "code_reviewer", prompt = reviewPrompt) {
  await hooks["tool.execute.before"]({ tool: "task", sessionID: "parent", callID }, { args: { subagent_type: agent, prompt } });
  await hooks["tool.execute.after"]({ tool: "task", sessionID: "parent", callID }, { output: JSON.stringify({ task_id: `child-${callID}` }) });
}

await assert.rejects(() => start("bad", "code_reviewer", "Please review this."), /exact diff/);
await assert.rejects(() => start("keyword-only", "code_reviewer", "Read-only review; do not edit. Exact diff unavailable."), /exact diff/);
await assert.rejects(() => start("fake-boundary", "code_reviewer", "Read-only review. Do not edit or run commands. Source boundary: x"), /exact diff/);
await start("one");
await start("two");
await assert.rejects(() => start("three"), /concurrency limit/);
await hooks.event({ event: { type: "session.status", properties: { sessionID: "child-one", status: { type: "idle" } } } });
await start("three");
await hooks.event({ event: { type: "session.status", properties: { sessionID: "child-two", status: { type: "idle" } } } });
await hooks.event({ event: { type: "session.status", properties: { sessionID: "child-three", status: { type: "idle" } } } });
await assert.rejects(() => start("four"), /total limit/);

const foregroundHooks = await createDelegationGuard({ max_concurrent: 1, max_total: 2 });
async function completeForeground(callID) {
  const childID = `foreground-child-${callID}`;
  await foregroundHooks["tool.execute.before"]({ tool: "task", sessionID: "foreground-parent", callID }, { args: { subagent_type: "explore", prompt: "Inspect the exact source boundary." } });
  await foregroundHooks.event({ event: { type: "session.created", properties: { info: { id: childID, parentID: "foreground-parent" } } } });
  await foregroundHooks.event({ event: { type: "session.status", properties: { sessionID: childID, status: { type: "idle" } } } });
  await foregroundHooks["tool.execute.after"]({ tool: "task", sessionID: "foreground-parent", callID }, { output: JSON.stringify({ task_id: childID }) });
}
await completeForeground("one");
await completeForeground("two");

const metadataHooks = await createDelegationGuard({ max_concurrent: 1, max_total: 1 });
await metadataHooks["tool.execute.before"]({ tool: "task", sessionID: "metadata-parent", callID: "metadata" }, { args: { subagent_type: "explore", prompt: "Inspect src/cli/ and return the exact source boundary." } });
await metadataHooks["tool.execute.after"]({ tool: "task", sessionID: "metadata-parent", callID: "metadata" }, { output: "task started", metadata: { sessionId: "metadata-child" } });
await metadataHooks.event({ event: { type: "session.status", properties: { sessionID: "metadata-child", status: { type: "idle" } } } });
await assert.rejects(() => metadataHooks["tool.execute.before"]({ tool: "task", sessionID: "metadata-parent", callID: "after-metadata" }, { args: { subagent_type: "explore", prompt: "Inspect src/cli/ and return the exact source boundary." } }), /total limit/);

const nestedHooks = await createDelegationGuard({ max_concurrent: 2, max_total: 2 });
// Managed subagent_depth: 1 prevents nested native Task calls in normal operation.
await nestedHooks["tool.execute.before"]({ tool: "task", sessionID: "nested-parent", callID: "nested-root" }, { args: { subagent_type: "explore", prompt: "Inspect src/cli/ and return the exact source boundary." } });
await nestedHooks["tool.execute.after"]({ tool: "task", sessionID: "nested-parent", callID: "nested-root" }, { output: JSON.stringify({ task_id: "nested-child" }) });
await nestedHooks["tool.execute.before"]({ tool: "task", sessionID: "nested-child", callID: "nested-grandchild" }, { args: { subagent_type: "explore", prompt: "Inspect src/cli/ and return the exact source boundary." } });
await nestedHooks["tool.execute.after"]({ tool: "task", sessionID: "nested-child", callID: "nested-grandchild" }, { output: JSON.stringify({ task_id: "nested-grandchild" }) });
await nestedHooks.event({ event: { type: "session.status", properties: { sessionID: "nested-child", status: { type: "idle" } } } });
await nestedHooks.event({ event: { type: "session.status", properties: { sessionID: "nested-grandchild", status: { type: "idle" } } } });
await assert.rejects(() => nestedHooks["tool.execute.before"]({ tool: "task", sessionID: "nested-parent", callID: "nested-after" }, { args: { subagent_type: "explore", prompt: "Inspect src/cli/ and return the exact source boundary." } }), /total limit/);

const mutationHooks = await createDelegationGuard();
await assert.rejects(() => mutationHooks["tool.execute.before"]({ tool: "task", sessionID: "mutation-parent", callID: "mutation" }, { args: { subagent_type: "code_reviewer", prompt: `${reviewPrompt} Apply a patch before reporting.` } }), /read-only contract/);
console.log("OK     OpenCode delegation guard");
