#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const stateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-goal-mode-test-"));
const statePath = path.join(stateDirectory, "goals.json");
const originalStatePath = process.env.OPENCODE_GOAL_STATE_PATH;

try {
  process.env.OPENCODE_GOAL_STATE_PATH = statePath;
  const goalModePath = path.join(repoRoot, "opencode", "plugins", "goal-mode.js");
  const goalModeSource = fs.readFileSync(goalModePath, "utf8");
  assert.doesNotMatch(goalModeSource, /from "effect"/);
  assert.doesNotMatch(goalModeSource, /from "zod"/);
  assert.match(
    fs.readFileSync(path.join(repoRoot, "opencode", "plugins", "goal-mode.LICENSE"), "utf8"),
    /MIT License/,
  );

  const goalMode = (await import(goalModePath)).default;
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

  console.log("OK     Vendored OpenCode goal mode");
} finally {
  if (originalStatePath === undefined) {
    delete process.env.OPENCODE_GOAL_STATE_PATH;
  } else {
    process.env.OPENCODE_GOAL_STATE_PATH = originalStatePath;
  }
  fs.rmSync(stateDirectory, { recursive: true, force: true });
}
