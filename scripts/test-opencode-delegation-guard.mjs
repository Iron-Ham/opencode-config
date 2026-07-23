#!/usr/bin/env bun

import assert from "node:assert/strict";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const { testHelpers } = await import(path.join(repoRoot, "opencode", "plugins", "delegation-guard.js"));
const { createDelegationGuard } = testHelpers;
const hooks = await createDelegationGuard({ max_concurrent: 2, max_total: 3 });
const reviewPrompt = "Review the requested change.";

const implementationHooks = await createDelegationGuard({ max_concurrent: 1, max_total: 1 });
await implementationHooks["tool.execute.before"](
  { tool: "task", sessionID: "implementation-parent", callID: "implementation-task" },
  { args: { subagent_type: "luna_implementer", prompt: "Implement the requested bounded change." } },
);
await implementationHooks["tool.execute.after"](
  { tool: "task", sessionID: "implementation-parent", callID: "implementation-task" },
  { output: JSON.stringify({ task_id: "implementation-child" }) },
);

const readerHooks = await createDelegationGuard({ max_concurrent: 1, max_total: 1 });
await readerHooks["tool.execute.before"](
  { tool: "task", sessionID: "reader-parent", callID: "reader-task" },
  { args: { subagent_type: "luna_reader", prompt: "Investigate the requested behavior." } },
);
await readerHooks["tool.execute.after"](
  { tool: "task", sessionID: "reader-parent", callID: "reader-task" },
  { output: JSON.stringify({ task_id: "reader-child" }) },
);

const vocabularyHooks = await createDelegationGuard({ max_concurrent: 1, max_total: 1 });
await vocabularyHooks["tool.execute.before"](
  { tool: "task", sessionID: "vocabulary-parent", callID: "permission-investigation" },
  {
    args: {
      subagent_type: "luna_reader",
      prompt: [
        "Read-only source retrieval. Do not edit or run commands.",
        "Search boundary: `src/tools/`.",
        "Investigation: explain whether the edit permission is denied for this reader.",
        "Delegation value: the controller will reconcile a separate implementation boundary.",
      ].join("\n"),
    },
  },
);
await vocabularyHooks["tool.execute.after"](
  { tool: "task", sessionID: "vocabulary-parent", callID: "permission-investigation" },
  { output: JSON.stringify({ task_id: "vocabulary-child" }) },
);

const evidenceReaderHooks = await createDelegationGuard({ max_concurrent: 1, max_total: 1 });
await evidenceReaderHooks["tool.execute.before"](
  { tool: "task", sessionID: "evidence-reader-parent", callID: "evidence-reader-task" },
  { args: { subagent_type: "evidence_reader", prompt: "Gather evidence for the requested behavior." } },
);
await evidenceReaderHooks["tool.execute.after"](
  { tool: "task", sessionID: "evidence-reader-parent", callID: "evidence-reader-task" },
  { output: JSON.stringify({ task_id: "evidence-reader-child" }) },
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

console.log("OK     OpenCode delegation guard");
