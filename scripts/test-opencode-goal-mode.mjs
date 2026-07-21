#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-goal-mode-test-"));
const statePath = path.join(stateDirectory, "goals.json");
const originalStatePath = process.env.OPENCODE_GOAL_STATE_PATH;
const evidenceDirectory = path.join(stateDirectory, "completion-evidence");
const originalEvidenceDirectory = process.env.OPENCODE_COMPLETION_EVIDENCE_DIR;

try {
  process.env.OPENCODE_GOAL_STATE_PATH = statePath;
  process.env.OPENCODE_COMPLETION_EVIDENCE_DIR = evidenceDirectory;
  const goalModePath = path.join(repoRoot, "opencode", "plugins", "goal-mode.js");
  const goalModeSource = fs.readFileSync(goalModePath, "utf8");
  const goalModeTuiSource = fs.readFileSync(
    path.join(repoRoot, "opencode", "plugins", "goal-mode-tui.tsx"),
    "utf8",
  );
  assert.doesNotMatch(goalModeSource, /from "effect"/);
  assert.doesNotMatch(goalModeSource, /from "zod"/);
  assert.match(
    fs.readFileSync(path.join(repoRoot, "opencode", "plugins", "goal-mode.LICENSE"), "utf8"),
    /MIT License/,
  );
  assert.match(goalModeTuiSource, /"record_goal_progress"/);
  assert.match(goalModeTuiSource, /"record_goal_failure"/);
  assert.match(goalModeTuiSource, /Handoff: \$\{goal\.handoff\.classification\}/);

  const goalMode = (await import(goalModePath)).default;
  const { persistCompletionEvidence } = (await import(
    path.join(repoRoot, "opencode", "plugins", "goal-workflow-guard.js"),
  )).testHelpers;
  assert.equal(goalMode.id, "claude-config-goal-mode");
  const hooks = await goalMode.server({ client: {} }, { auto_continue: false });
  const context = { sessionID: "goal-test", agent: "build" };
  const created = JSON.parse(
    await hooks.tool.create_goal.execute(
      { objective: "Vendor the managed goal workflow.", options: {} },
      context,
    ),
  );
  assert.equal(created.goal.status, "active");
  assert.equal(created.goal.objective, "Vendor the managed goal workflow.");
  assert.deepEqual(created.goal.requiredOutcomes, ["Vendor the managed goal workflow."]);
  assert.deepEqual(created.goal.completionBaselineOutcomes, ["Vendor the managed goal workflow."]);
  assert.equal(created.goal.maxNoProgressTurns, 3);

  const active = JSON.parse(await hooks.tool.get_goal.execute({}, context));
  assert.equal(active.goal.sessionID, "goal-test");
  assert.equal(fs.statSync(statePath).mode & 0o777, 0o600);

  const paused = JSON.parse(
    await hooks.tool.update_goal_status.execute({ status: "paused" }, context),
  );
  assert.equal(paused.goal.status, "paused");

  const cleared = JSON.parse(await hooks.tool.clear_goal.execute({}, context));
  assert.equal(cleared.cleared, true);
  assert.equal(JSON.parse(await hooks.tool.get_goal.execute({}, context)).goal, null);

  async function createGoalFor(pluginHooks, sessionID, agent = "build") {
    return JSON.parse(
      await pluginHooks.tool.create_goal.execute(
        { objective: `Goal for ${sessionID}.`, options: {} },
        { sessionID, agent },
      ),
    ).goal;
  }

  async function goalFor(pluginHooks, sessionID, agent = "build") {
    return JSON.parse(
      await pluginHooks.tool.get_goal.execute({}, { sessionID, agent }),
    ).goal;
  }

  async function authorizedCompletion(sessionID, callID, evidence, handoff) {
    const authorization = `test-authorization-${sessionID}-${callID}`;
    await persistCompletionEvidence({
      sessionID,
      callID,
      manifest: JSON.parse(evidence),
      handoff,
      authorizationID: authorization,
    });
    return authorization;
  }

  function updateStoredGoal(sessionID, update) {
    const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
    Object.assign(state.goals[sessionID], update);
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  }

  await createGoalFor(hooks, "validation-progress");
  updateStoredGoal("validation-progress", { noProgressTurns: 2 });
  const validationProgress = JSON.parse(
    await hooks.tool.record_goal_progress.execute(
      {
        kind: "validation",
        source: "bun scripts/test-opencode-goal-mode.mjs",
        fingerprint: "validation:goal-mode",
        summary: "Focused goal-mode regression suite passed.",
        validation_status: "passed",
      },
      { sessionID: "validation-progress", agent: "build" },
    ),
  ).goal;
  assert.equal(validationProgress.noProgressTurns, 0);
  assert.equal(validationProgress.progressEvents.at(-1).kind, "validation");
  assert.equal(validationProgress.validationResults.at(-1).status, "passed");
  assert.match(validationProgress.lastProgressSignature, /^validation:sha256:/);

  let prosePrompts = 0;
  const proseAssistant = {
    id: "prose-1",
    role: "assistant",
    info: { time: { created: 1_000_000_000_000, completed: 1_000_000_002_000 } },
    parts: [
      { type: "text", text: "Repeated assistant prose without an observable change." },
      { type: "step-finish", tokens: { output: 200 } },
    ],
  };
  const proseHooks = await goalMode.server({
    client: {
      session: {
        messages: async () => ({ data: [proseAssistant] }),
        promptAsync: async () => {
          prosePrompts += 1;
        },
      },
    },
  }, { auto_continue: true, min_continue_interval_seconds: 1 });
  await createGoalFor(proseHooks, "prose-only");
  updateStoredGoal("prose-only", {
    awaitingContinuationProgress: true,
    continuationBaselineMessageID: "prose-0",
    continuationBaselineSummary: "Repeated assistant prose without an observable change.",
    continuationBaselineProgressEpoch: 0,
    lastAssistantMessageID: "prose-0",
    lastAssistantText: "Repeated assistant prose without an observable change.",
  });
  await proseHooks.event({
    event: { type: "session.idle", properties: { sessionID: "prose-only" } },
  });
  const proseOnly = await goalFor(proseHooks, "prose-only");
  assert.equal(proseOnly.noProgressTurns, 1);
  assert.equal(proseOnly.progressEvents.length, 0);
  assert.equal(proseOnly.modelTimeSeconds, 2);
  assert.equal(typeof proseOnly.wrapperTimeSeconds, "number");
  assert.equal(prosePrompts, 1);
  await proseHooks["experimental.chat.messages.transform"](
    { sessionID: "prose-only" },
    { messages: [proseAssistant] },
  );
  assert.equal((await goalFor(proseHooks, "prose-only")).modelTimeSeconds, 2);
  await proseHooks.dispose();

  let transientPrompts = 0;
  const transientHooks = await goalMode.server({
    client: {
      session: {
        messages: async () => ({
          data: [{ id: "transient-0", role: "assistant", parts: [{ type: "text", text: "Ready to continue." }] }],
        }),
        promptAsync: async () => {
          transientPrompts += 1;
          throw new Error("temporary provider timeout");
        },
      },
    },
  }, { auto_continue: true, retry_base_seconds: 60, retry_max_seconds: 60 });
  const ultraGoal = await createGoalFor(transientHooks, "transient-provider", "ultra");
  assert.equal(ultraGoal.sessionID, "transient-provider");
  await transientHooks.event({
    event: { type: "session.idle", properties: { sessionID: "transient-provider" } },
  });
  const transient = await goalFor(transientHooks, "transient-provider", "ultra");
  assert.equal(transientPrompts, 1);
  assert.equal(transient.status, "active");
  assert.equal(transient.lastFailure.failureClass, "provider-transient");
  assert.equal(transient.retryAttempts, 1);
  assert.ok(transient.nextRetryAt >= Math.floor(Date.now() / 1000));
  assert.equal(transient.failureEvents.length, 1);
  await transientHooks.dispose();

  updateStoredGoal("transient-provider", {
    nextRetryAt: Math.floor(Date.now() / 1000) - 1,
    lastContinuationAt: null,
  });
  let recoveredRetryPrompts = 0;
  const recoveredRetryHooks = await goalMode.server({
    client: {
      session: {
        messages: async () => ({
          data: [{ id: "recovered-retry", role: "assistant", parts: [{ type: "text", text: "Retrying after reload." }] }],
        }),
        promptAsync: async () => {
          recoveredRetryPrompts += 1;
        },
        status: async () => ({ data: { "transient-provider": { type: "idle" } } }),
      },
    },
  }, { auto_continue: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(recoveredRetryPrompts, 1);
  assert.equal((await goalFor(recoveredRetryHooks, "transient-provider", "ultra")).nextRetryAt, null);
  await recoveredRetryHooks.dispose();

  await createGoalFor(hooks, "busy-retry");
  await hooks.tool.record_goal_failure.execute(
    {
      failure_class: "provider-transient",
      source: "provider:openai",
      fingerprint: "provider:busy-retry",
      summary: "A transient provider timeout needs a retry.",
      next_action: "Wait for the backoff and retry the same route.",
    },
    { sessionID: "busy-retry", agent: "build" },
  );
  updateStoredGoal("busy-retry", { nextRetryAt: Math.floor(Date.now() / 1000), lastContinuationAt: null });
  let busyRetryPrompts = 0;
  const busyRetryHooks = await goalMode.server({
    client: {
      session: {
        messages: async () => ({
          data: [{ id: "busy-retry-message", role: "assistant", parts: [{ type: "text", text: "Retry after idle." }] }],
        }),
        promptAsync: async () => {
          busyRetryPrompts += 1;
        },
        status: async () => ({ data: { "busy-retry": { type: "busy" } } }),
      },
    },
  }, { auto_continue: true });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(busyRetryPrompts, 0);
  await busyRetryHooks.event({
    event: { type: "session.idle", properties: { sessionID: "busy-retry" } },
  });
  assert.equal(busyRetryPrompts, 1);
  await busyRetryHooks.dispose();

  for (const [sessionID, message, failureClass, status] of [
    ["auto-context-limit", "maximum input token limit reached", "context-limit", "blocked"],
    ["auto-missing-auth", "API key authentication failed", "missing-auth", "blocked"],
    ["auto-permission", "permission denied by the workspace", "permission-denied", "blocked"],
    ["auto-interactive", "interactive confirmation required", "interactive-input-required", "blocked"],
    ["auto-dependency", "service unavailable", "external-dependency-blocked", "blocked"],
    ["auto-boundary", "outside authorized source boundary", "source-boundary-violation", "blocked"],
    ["auto-terminal-provider", "configured model unavailable", "provider-terminal", "stopped"],
  ]) {
    const classifiedHooks = await goalMode.server({
      client: {
        session: {
          messages: async () => ({
            data: [{ id: `${sessionID}-message`, role: "assistant", parts: [{ type: "text", text: "Attempting continuation." }] }],
          }),
          promptAsync: async () => {
            throw new Error(message);
          },
        },
      },
    }, { auto_continue: true });
    await createGoalFor(classifiedHooks, sessionID);
    await classifiedHooks.event({
      event: { type: "session.idle", properties: { sessionID } },
    });
    const classified = await goalFor(classifiedHooks, sessionID);
    assert.equal(classified.status, status);
    assert.equal(classified.terminalFailure.failureClass, failureClass);
    assert.ok(classified.terminalFailure.nextAction.length > 0);
    await classifiedHooks.dispose();
  }

  await createGoalFor(hooks, "terminal-provider");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await hooks.tool.record_goal_failure.execute(
      {
        failure_class: "provider-terminal",
        source: "provider:openai",
        fingerprint: "provider:terminal:model-unavailable",
        summary: "The configured model is unavailable from the provider.",
        next_action: "Choose an approved provider route explicitly before resuming.",
      },
      { sessionID: "terminal-provider", agent: "build" },
    );
    const terminal = await goalFor(hooks, "terminal-provider");
    if (attempt < 3) assert.equal(terminal.status, "stopped");
  }
  const terminalProvider = await goalFor(hooks, "terminal-provider");
  assert.equal(terminalProvider.status, "blocked");
  assert.equal(terminalProvider.terminalFailure.failureClass, "provider-terminal");
  assert.equal(terminalProvider.consecutiveFailureCount, 3);

  await createGoalFor(hooks, "context-limit");
  updateStoredGoal("context-limit", {
    checkpoints: [{ summary: "Verified the current source boundary.", timestamp: 1 }],
    lastCheckpoint: { summary: "Verified the current source boundary.", timestamp: 1 },
  });
  const contextFailure = JSON.parse(
    await hooks.tool.record_goal_failure.execute(
      {
        failure_class: "context-limit",
        source: "provider:openai",
        fingerprint: "context:request-too-large",
        summary: "The individual request exceeds the route input limit.",
        next_action: "Reduce the next request or use active-model compaction before retrying.",
      },
      { sessionID: "context-limit", agent: "build" },
    ),
  ).goal;
  assert.equal(contextFailure.status, "blocked");
  assert.equal(contextFailure.lastCheckpoint.summary, "Verified the current source boundary.");
  assert.equal(contextFailure.terminalFailure.failureClass, "context-limit");
  assert.match(contextFailure.terminalFailure.nextAction, /Reduce the next request/);

  await createGoalFor(hooks, "concrete-next-action");
  const concreteNextAction = "Request the approval for the external dependency, then resume this goal.";
  const concreteFailure = JSON.parse(
    await hooks.tool.record_goal_failure.execute(
      {
        failure_class: "external-dependency-blocked",
        source: "dependency:release-service",
        fingerprint: "dependency:approval-required",
        summary: "The release service requires an approval before it can continue.",
        next_action: concreteNextAction,
      },
      { sessionID: "concrete-next-action", agent: "build" },
    ),
  ).goal;
  assert.equal(concreteFailure.terminalFailure.nextAction, concreteNextAction);

  await createGoalFor(hooks, "validation-stalled");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await hooks.tool.record_goal_progress.execute(
      {
        kind: "validation",
        source: "bun scripts/test-opencode-goal-mode.mjs",
        fingerprint: "validation:repeat-failure",
        summary: "Focused goal-mode regression suite failed without a source change.",
        validation_status: "failed",
      },
      { sessionID: "validation-stalled", agent: "build" },
    );
  }
  const validationStalled = await goalFor(hooks, "validation-stalled");
  assert.equal(validationStalled.status, "stopped");
  assert.equal(validationStalled.terminalFailure.failureClass, "validation-stalled");
  assert.equal(validationStalled.validationFailureCount, 3);

  await createGoalFor(hooks, "tool-loop");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    await hooks["tool.execute.before"]({
      sessionID: "tool-loop",
      tool: "read",
      args: { filePath: "unchanged.txt" },
    });
    await hooks["tool.execute.after"](
      { sessionID: "tool-loop", tool: "read", args: { filePath: "unchanged.txt" } },
      { output: "unchanged" },
    );
  }
  const toolLoop = await goalFor(hooks, "tool-loop");
  assert.equal(toolLoop.status, "stopped");
  assert.equal(toolLoop.terminalFailure.failureClass, "no-progress");
  assert.equal(toolLoop.repeatedToolCalls, 3);

  await createGoalFor(hooks, "successful-third-call");
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    await hooks["tool.execute.before"]({
      sessionID: "successful-third-call",
      tool: "edit",
      args: { filePath: "progress.txt", replacement: "same" },
    });
    await hooks["tool.execute.after"](
      { sessionID: "successful-third-call", tool: "edit", args: { filePath: "progress.txt", replacement: "same" } },
      { status: "error", error: "edit failed" },
    );
  }
  await hooks["tool.execute.before"]({
    sessionID: "successful-third-call",
    tool: "edit",
    args: { filePath: "progress.txt", replacement: "same" },
  });
  await hooks["tool.execute.after"](
    { sessionID: "successful-third-call", tool: "edit", args: { filePath: "progress.txt", replacement: "same" } },
    { output: "edit applied" },
  );
  const successfulThirdCall = await goalFor(hooks, "successful-third-call");
  assert.equal(successfulThirdCall.status, "active");
  assert.equal(successfulThirdCall.repeatedToolCalls, 0);
  assert.equal(successfulThirdCall.progressEvents.at(-1).kind, "source-mutation");

  await createGoalFor(hooks, "before-hook-arguments");
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const callID = `before-hook-${attempt}`;
    await hooks["tool.execute.before"](
      { sessionID: "before-hook-arguments", callID, tool: "read" },
      { args: { filePath: "unchanged.txt" } },
    );
    await hooks["tool.execute.after"](
      { sessionID: "before-hook-arguments", callID, tool: "read" },
      { output: "unchanged" },
    );
  }
  assert.equal((await goalFor(hooks, "before-hook-arguments")).status, "stopped");

  await createGoalFor(hooks, "failed-bash-exit");
  await hooks["tool.execute.before"](
    { sessionID: "failed-bash-exit", callID: "failed-bash", tool: "bash" },
    { args: { command: "bun test" } },
  );
  await hooks["tool.execute.after"](
    { sessionID: "failed-bash-exit", callID: "failed-bash", tool: "bash" },
    { output: "validation failed", metadata: { exit: 1 } },
  );
  assert.equal(
    (await goalFor(hooks, "failed-bash-exit")).validationResults.at(-1).status,
    "failed",
  );

  const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
  state.goals.legacy = {
    sessionID: "legacy",
    objective: "Load a persisted pre-progress goal.",
    status: "active",
    tokensUsed: 0,
    timeUsedSeconds: 0,
    createdAt: 1,
    updatedAt: 1,
    autoTurns: 0,
  };
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
  const legacy = await goalFor(hooks, "legacy");
  assert.deepEqual(legacy.progressEvents, []);
  assert.deepEqual(legacy.validationResults, []);
  assert.deepEqual(legacy.failureEvents, []);
  assert.equal(legacy.terminalFailure, null);
  assert.equal(legacy.modelTimeSeconds, null);
  assert.equal(legacy.wrapperTimeSeconds, null);
  assert.deepEqual(legacy.requiredOutcomes, ["Load a persisted pre-progress goal."]);
  assert.deepEqual(legacy.completionBaselineOutcomes, ["Load a persisted pre-progress goal."]);

  await createGoalFor(hooks, "baseline-revision");
  const baselineBeforeRevision = await goalFor(hooks, "baseline-revision");
  const revisedWithoutBaseline = JSON.parse(
    await hooks.tool.update_goal_objective.execute(
      { objective: "A revised implementation objective.", options: {} },
      { sessionID: "baseline-revision", agent: "build" },
    ),
  ).goal;
  assert.deepEqual(
    revisedWithoutBaseline.completionBaselineOutcomes,
    baselineBeforeRevision.completionBaselineOutcomes,
  );
  const revisedAgain = JSON.parse(
    await hooks.tool.update_goal_objective.execute(
      {
        objective: "A second revised implementation objective.",
        options: {},
      },
      { sessionID: "baseline-revision", agent: "build" },
    ),
  ).goal;
  assert.deepEqual(
    revisedAgain.completionBaselineOutcomes,
    baselineBeforeRevision.completionBaselineOutcomes,
  );

  const explicitOutcomes = JSON.parse(
    await hooks.tool.create_goal.execute(
      {
        objective: "A goal with separately declared completion outcomes.",
        options: { required_outcomes: ["First declared outcome", "Second declared outcome"] },
      },
      { sessionID: "explicit-outcomes", agent: "build" },
    ),
  ).goal;
  assert.deepEqual(explicitOutcomes.completionBaselineOutcomes, [
    "First declared outcome",
    "Second declared outcome",
  ]);

  const carryableHandoff = {
    classification: "carryable",
    summary: "The verified result is ready for normal engineering handoff.",
    next_action: "Review and merge through the normal process.",
    source_boundary: "opencode/plugins/**",
    expected_changed_files: ["opencode/plugins/goal-mode.js"],
    actual_changed_files: ["opencode/plugins/goal-mode.js"],
  };
  await createGoalFor(hooks, "carryable-handoff");
  const carryableEvidence = JSON.stringify({
    schema_version: 1,
    summary: "The carryable handoff is complete.",
    checks: [{ requirement: "Goal for carryable-handoff.", status: "passed", evidence: [{ kind: "test", reference: "goal-mode test", result: "passed" }] }],
    remaining_work: [],
  });
  const carryableCallID = "carryable-handoff-completion";
  const carryableAuthorization = await authorizedCompletion("carryable-handoff", carryableCallID, carryableEvidence, carryableHandoff);
  const carryable = JSON.parse(
    await hooks.tool.update_goal.execute(
      {
        status: "complete",
        options: {
          evidence: carryableEvidence,
          handoff: carryableHandoff,
          completion_authorization: carryableAuthorization,
        },
      },
      { sessionID: "carryable-handoff", callID: carryableCallID, agent: "build" },
    ),
  ).goal;
  assert.equal(carryable.handoff.classification, "carryable");
  assert.equal(carryable.handoff.actualChangedFileCount, 1);
  assert.match(carryable.completionEvidence.artifactID, /^sha256:/);
  await assert.rejects(() =>
    hooks.tool.update_goal.execute(
      {
        status: "complete",
        options: {
          evidence: carryableEvidence,
          handoff: carryableHandoff,
          completion_authorization: carryableAuthorization,
        },
      },
      { sessionID: "carryable-handoff", callID: carryableCallID, agent: "build" },
    ),
    /already been consumed/,
  );

  await createGoalFor(hooks, "missing-required-outcome");
  await assert.rejects(() =>
    hooks.tool.update_goal.execute(
      {
        status: "complete",
        options: {
          evidence: JSON.stringify({
            schema_version: 1,
            summary: "An unrelated requirement passed.",
            checks: [{ requirement: "A different requirement", status: "passed", evidence: [] }],
            remaining_work: [],
          }),
        },
      },
      { sessionID: "missing-required-outcome", agent: "build" },
    )
  );

  for (const classification of ["repairable", "blocked"]) {
    const sessionID = `${classification}-handoff`;
    await createGoalFor(hooks, sessionID);
    const result = JSON.parse(
      await hooks.tool.update_goal.execute(
        {
          status: "unmet",
          options: {
            blocker: "A concrete follow-up remains before the goal can be complete.",
            handoff: {
              classification,
              summary: "The next engineer has a bounded, explicit follow-up.",
              next_action: "Complete the recorded follow-up and rerun validation.",
            },
          },
        },
        { sessionID, agent: "build" },
      ),
    ).goal;
    assert.equal(result.status, "unmet");
    assert.equal(result.handoff.classification, classification);
  }
  const actionableBlocker = "Grant the required service access, then resume the goal.";
  await createGoalFor(hooks, "actionable-unmet-blocker");
  const actionableUnmet = JSON.parse(
    await hooks.tool.update_goal.execute(
      {
        status: "unmet",
        options: { blocker: actionableBlocker },
      },
      { sessionID: "actionable-unmet-blocker", agent: "build" },
    ),
  );
  assert.equal(actionableUnmet.goal.blocker, actionableBlocker);
  assert.equal(actionableUnmet.goal.history.at(-1).detail, actionableBlocker);
  assert.match(actionableUnmet.unmet_report, /Grant the required service access/);
  const actionableCompaction = { context: [] };
  await hooks["experimental.session.compacting"](
    { sessionID: "actionable-unmet-blocker" },
    actionableCompaction,
  );
  assert.match(actionableCompaction.context.at(-1), /Grant the required service access/);
  await createGoalFor(hooks, "unsafe-blocker");
  for (const unsafeBlocker of [
    "Authorization: Bearer super-secret-value",
    "access_token=super-secret-value",
    "refresh_token=super-secret-value",
    "client_secret=super-secret-value",
    "session_id=super-secret-value",
    "sk-proj-abcdefghijklmnopqrstuvwxyz",
  ]) {
    await assert.rejects(() =>
      hooks.tool.update_goal.execute(
        {
          status: "unmet",
          options: { blocker: unsafeBlocker },
        },
        { sessionID: "unsafe-blocker", agent: "build" },
      ),
      /must not contain credentials/,
    );
  }
  await createGoalFor(hooks, "invalid-handoff");
  await assert.rejects(() =>
    hooks.tool.update_goal.execute(
      {
        status: "complete",
        options: {
          evidence: JSON.stringify({
            schema_version: 1,
            summary: "The result is otherwise complete.",
            checks: [{ requirement: "Goal for invalid-handoff.", status: "passed", evidence: [] }],
            remaining_work: [],
          }),
          handoff: {
            classification: "repairable",
            summary: "The result still needs repair.",
            next_action: "Repair it.",
          },
        },
      },
      { sessionID: "invalid-handoff", agent: "build" },
    )
  );

  const parentPrompts = [];
  const parentHooks = await goalMode.server({
    client: {
      session: {
        messages: async () => ({ data: [] }),
        promptAsync: async (request) => {
          parentPrompts.push(request);
        },
      },
    },
  }, { auto_continue: true });
  await createGoalFor(parentHooks, "deferred-parent");
  await parentHooks.event({
    event: {
      type: "session.created",
      properties: { info: { id: "deferred-child", parentID: "deferred-parent" } },
    },
  });
  await parentHooks.event({
    event: { type: "session.idle", properties: { sessionID: "deferred-parent" } },
  });
  await parentHooks.event({
    event: { type: "session.idle", properties: { sessionID: "deferred-child" } },
  });
  await Bun.sleep(100);
  assert.equal(parentPrompts.length, 1);
  assert.equal(parentPrompts[0].path.id, "deferred-parent");
  await parentHooks.dispose();

  const deletedChildPrompts = [];
  const deletedChildHooks = await goalMode.server({
    client: {
      session: {
        messages: async () => ({ data: [] }),
        promptAsync: async (request) => {
          deletedChildPrompts.push(request);
        },
      },
    },
  }, { auto_continue: true });
  await createGoalFor(deletedChildHooks, "deleted-child-parent");
  await deletedChildHooks.event({
    event: {
      type: "session.created",
      properties: { info: { id: "deleted-child", parentID: "deleted-child-parent" } },
    },
  });
  await deletedChildHooks.event({
    event: { type: "session.idle", properties: { sessionID: "deleted-child-parent" } },
  });
  await deletedChildHooks.event({
    event: { type: "session.deleted", properties: { info: { id: "deleted-child" } } },
  });
  await Bun.sleep(100);
  assert.equal(deletedChildPrompts.length, 1);
  assert.equal(deletedChildPrompts[0].path.id, "deleted-child-parent");
  await deletedChildHooks.dispose();

  const lockDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-goal-lock-test-"));
  const lockStatePath = path.join(lockDirectory, "goals.json");
  const childSource = `import plugin from ${JSON.stringify(pathToFileURL(goalModePath).href)}; const hooks = await plugin.server({ client: {} }, { auto_continue: false }); await hooks.tool.create_goal.execute({ objective: process.env.GOAL_OBJECTIVE, options: {} }, { sessionID: process.env.GOAL_SESSION, agent: "build" });`;
  const createConcurrentGoal = async (sessionID) => {
    const child = Bun.spawn(["bun", "--eval", childSource], {
      env: {
        ...process.env,
        GOAL_OBJECTIVE: `Goal for ${sessionID}.`,
        GOAL_SESSION: sessionID,
        OPENCODE_GOAL_STATE_PATH: lockStatePath,
      },
      stdout: "ignore",
      stderr: "pipe",
    });
    const exitCode = await child.exited;
    assert.equal(exitCode, 0, await new Response(child.stderr).text());
  };
  try {
    await Promise.all([createConcurrentGoal("lock-one"), createConcurrentGoal("lock-two")]);
    const lockedState = JSON.parse(fs.readFileSync(lockStatePath, "utf8"));
    assert.deepEqual(Object.keys(lockedState.goals).sort(), ["lock-one", "lock-two"]);
    assert.equal(fs.existsSync(`${lockStatePath}.lock`), false);
  } finally {
    fs.rmSync(lockDirectory, { recursive: true, force: true });
  }

  let ordinaryBuildPrompts = 0;
  const noGoalHooks = await goalMode.server({
    client: {
      session: {
        messages: async () => ({ data: [] }),
        promptAsync: async () => {
          ordinaryBuildPrompts += 1;
        },
      },
    },
  }, { auto_continue: true });
  await noGoalHooks.event({
    event: { type: "session.idle", properties: { sessionID: "ordinary-build-without-goal", agent: "build" } },
  });
  assert.equal(ordinaryBuildPrompts, 0);
  assert.equal(await goalFor(noGoalHooks, "ordinary-build-without-goal"), null);
  await noGoalHooks.dispose();

  console.log("OK     Vendored OpenCode goal mode");
} finally {
  if (originalStatePath === undefined) {
    delete process.env.OPENCODE_GOAL_STATE_PATH;
  } else {
    process.env.OPENCODE_GOAL_STATE_PATH = originalStatePath;
  }
  if (originalEvidenceDirectory === undefined) {
    delete process.env.OPENCODE_COMPLETION_EVIDENCE_DIR;
  } else {
    process.env.OPENCODE_COMPLETION_EVIDENCE_DIR = originalEvidenceDirectory;
  }
  fs.rmSync(stateDirectory, { recursive: true, force: true });
}
