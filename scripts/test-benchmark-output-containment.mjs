#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertRawBenchmarkOutputOutsideRepository,
} from "./benchmark-output-containment.mjs";

const repositoryRoot = fs.realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
);
const externalRoot = fs.mkdtempSync(
  path.join(os.tmpdir(), "benchmark-output-containment-test-"),
);

function runRunner(script, arguments_) {
  return Bun.spawnSync(
    ["bun", path.join(repositoryRoot, "scripts", script), ...arguments_],
    {
      cwd: repositoryRoot,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

function assertRunnerRejectsRepositoryOutput(script, arguments_, outputDir) {
  const result = runRunner(script, arguments_);
  assert.notEqual(result.exitCode, 0);
  assert.match(
    `${result.stdout.toString()}\n${result.stderr.toString()}`,
    /raw benchmark --output-dir must resolve outside the claude-config Git root/,
  );
  assert.equal(fs.existsSync(outputDir), false);
}

function assertRunnerAllowsExternalOutput(script, arguments_, laterError) {
  const result = runRunner(script, arguments_);
  assert.notEqual(result.exitCode, 0);
  const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
  assert.doesNotMatch(
    output,
    /raw benchmark --output-dir must resolve outside the claude-config Git root/,
  );
  assert.match(output, laterError);
}

try {
  const insideRepository = path.join(
    repositoryRoot,
    ".raw-benchmark-output-test",
    "not-created",
  );
  assert.throws(
    () => assertRawBenchmarkOutputOutsideRepository(insideRepository),
    /raw benchmark --output-dir must resolve outside the claude-config Git root/,
  );
  assert.equal(fs.existsSync(insideRepository), false);

  const externalOutput = path.join(externalRoot, "not-created", "results");
  assert.equal(
    assertRawBenchmarkOutputOutsideRepository(externalOutput),
    path.join(fs.realpathSync(externalRoot), "not-created", "results"),
  );
  assert.equal(fs.existsSync(externalOutput), false);

  const privateTemporaryOutput = path.join(
    "/private/tmp",
    `benchmark-output-containment-${process.pid}`,
    "results",
  );
  assert.equal(
    assertRawBenchmarkOutputOutsideRepository(privateTemporaryOutput),
    path.join(
      fs.realpathSync("/private/tmp"),
      `benchmark-output-containment-${process.pid}`,
      "results",
    ),
  );

  const insideLink = path.join(externalRoot, "inside-repository-link");
  fs.symlinkSync(repositoryRoot, insideLink);
  assert.throws(
    () => assertRawBenchmarkOutputOutsideRepository(
      path.join(insideLink, "not-created", "results"),
    ),
    /raw benchmark --output-dir must resolve outside the claude-config Git root/,
  );

  const externalTarget = path.join(externalRoot, "external-target");
  fs.mkdirSync(externalTarget);
  const externalLink = path.join(externalRoot, "external-link");
  fs.symlinkSync(externalTarget, externalLink);
  assert.equal(
    assertRawBenchmarkOutputOutsideRepository(
      path.join(externalLink, "not-created", "results"),
    ),
    path.join(fs.realpathSync(externalTarget), "not-created", "results"),
  );

  const modelPairsOutput = path.join(
    repositoryRoot,
    ".raw-model-pairs-output-test",
    "results",
  );
  assertRunnerRejectsRepositoryOutput(
    "benchmark-opencode-model-pairs.mjs",
    [
      "--task-file",
      path.join(externalRoot, "missing-task.md"),
      "--round",
      "containment-test",
      "--output-dir",
      modelPairsOutput,
      "--combos",
      "luna-sol",
      "--draft-only",
      "true",
    ],
    modelPairsOutput,
  );
  const externalModelPairsOutput = path.join(
    externalRoot,
    "model-pairs",
    "results",
  );
  assertRunnerAllowsExternalOutput(
    "benchmark-opencode-model-pairs.mjs",
    [
      "--task-file",
      path.join(externalRoot, "missing-task.md"),
      "--round",
      "containment-test",
      "--output-dir",
      externalModelPairsOutput,
      "--workdir",
      path.join(externalRoot, "missing-workdir"),
      "--combos",
      "luna-sol",
      "--draft-only",
      "true",
    ],
    /Workdir is not a directory/,
  );
  assert.equal(fs.statSync(externalModelPairsOutput).isDirectory(), true);

  const modelPairsGradingOutput = path.join(
    repositoryRoot,
    ".raw-model-pairs-grading-output-test",
    "results",
  );
  assertRunnerRejectsRepositoryOutput(
    "benchmark-opencode-model-pairs.mjs",
    [
      "--summary-file",
      path.join(externalRoot, "missing-summary.json"),
      "--round",
      "containment-test",
      "--output-dir",
      modelPairsGradingOutput,
      "--rubric-file",
      path.join(externalRoot, "missing-rubric.md"),
    ],
    modelPairsGradingOutput,
  );

  const swiftImplementersOutput = path.join(
    repositoryRoot,
    ".raw-swift-implementers-output-test",
    "results",
  );
  assertRunnerRejectsRepositoryOutput(
    "benchmark-opencode-swift-implementers.mjs",
    ["--output-dir", swiftImplementersOutput],
    swiftImplementersOutput,
  );
  assertRunnerAllowsExternalOutput(
    "benchmark-opencode-swift-implementers.mjs",
    ["--output-dir", path.join(externalRoot, "swift-implementers", "results")],
    /Missing --fixture-dir or manifest fixture_dir/,
  );

  const contextToolsOutput = path.join(
    repositoryRoot,
    ".raw-context-tools-output-test",
    "results",
  );
  assertRunnerRejectsRepositoryOutput(
    "benchmark-opencode-context-tools.mjs",
    [
      "--task-file",
      path.join(externalRoot, "missing-task.md"),
      "--workdir",
      externalRoot,
      "--output-dir",
      contextToolsOutput,
      "--model",
      "openai/gpt-5.6-terra",
      "--tool-node-modules",
      externalRoot,
      "--validation-command",
      "true",
    ],
    contextToolsOutput,
  );

  console.log("PASS raw benchmark output root containment");
} finally {
  fs.rmSync(externalRoot, { recursive: true, force: true });
}
