#!/usr/bin/env bun

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canonicalJson,
  inspectPolicyInstallation,
  parsePolicyManifest,
  policyConfigurationHash,
  redactPolicyResolution,
  readPolicyObservation,
  recordPolicyObservation,
  resolvePolicy,
  resolvePolicyFromSources,
} from "./resolve-opencode-policy.mjs";

const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const manifest = JSON.parse(
  fs.readFileSync(path.join(repoRoot, "opencode", "control-plane-policy.json"), "utf8"),
);
const EXPECTED_MANIFEST_HASH = "sha256:ad357fa8feb728513bafb46d6f5d113ddde3854c8a665b9cab9fd68ab7c8fa66";
const buildRoute = {
  provider: "openai",
  model: "gpt-5.6-terra",
  serving_path: "openai",
};
const adviseRoute = {
  provider: "anthropic",
  model: "claude-opus-4-8",
  serving_path: "anthropic",
};

function policyInput(mode, overrides = {}) {
  return {
    mode,
    repository_restrictions: {},
    characteristics: {
      boundedness: "normal_production",
      verification_strength: "deterministic",
      production_risk: "normal",
      unattended_authorized: mode === "ultra",
    },
    ...overrides,
  };
}

function effectiveConfig({ build = buildRoute, ultra = buildRoute, advisor = adviseRoute, disabled = [] } = {}) {
  return {
    disabled_providers: disabled,
    agents: {
      build,
      ultra,
      advisor_reviewer: advisor,
    },
  };
}

function catalogFor(route, { effort } = {}) {
  const model = { serving_path: route.serving_path };
  if (effort !== undefined) model.reasoning_effort = effort;
  return {
    providers: {
      [route.provider]: {
        status: "available",
        models: { [route.model]: model },
      },
    },
  };
}

function resolve(mode, options = {}) {
  const input = policyInput(mode, options.input);
  const route = options.effectiveRoute ??
    (mode === "advise" ? adviseRoute : buildRoute);
  const effective = options.effectiveConfig ?? effectiveConfig({
    build: mode === "build" ? route : buildRoute,
    ultra: mode === "ultra" ? route : buildRoute,
    advisor: mode === "advise" ? route : adviseRoute,
  });
  return resolvePolicy(input, {
    manifest: options.manifest ?? manifest,
    local: options.local ?? { policy_adapter_enabled: true, advisor_enabled: mode === "advise" },
    effectiveConfig: effective,
    liveCatalog: Object.hasOwn(options, "liveCatalog")
      ? options.liveCatalog
      : catalogFor(route, options.catalogOptions),
    loadCatalog: options.loadCatalog,
  });
}

function assertObserveOnly(result) {
  assert.equal(result.execution_altered, false);
  if (result.adapter_enabled) assert.equal(result.schema_version, 1);
}

const cases = [];
function caseOf(name, test) {
  cases.push({ name, test });
}

caseOf("compatible ordinary Build", () => {
  const result = resolve("build");
  assert.equal(result.state, "resolved");
  assert.equal(result.policy_route.id, "build-terra");
  assert.deepEqual(result.policy_route, { id: "build-terra", ...buildRoute });
  assert.deepEqual(result.effective_execution_route, buildRoute);
  assert.equal(result.route_metadata.reasoning_effort, "unavailable");
  assert.equal(result.fallback.disposition, "developer_action_required");
  assertObserveOnly(result);
});

caseOf("compatible explicit Ultra", () => {
  const result = resolve("ultra");
  assert.equal(result.state, "resolved");
  assert.equal(result.policy_route.id, "ultra-inherit-build");
  assert.deepEqual(result.policy_route, { id: "ultra-inherit-build", ...buildRoute });
  assert.equal(result.controls.continuation, "durable_goal_only");
  assert.deepEqual(result.effective_execution_route, buildRoute);
  assertObserveOnly(result);
});

caseOf("Ultra observes the invoking primary model", () => {
  const primary = {
    provider: "openai",
    model: "gpt-5.6-sol",
    serving_path: "openai",
  };
  const result = resolvePolicy(policyInput("ultra"), {
    manifest,
    local: { policy_adapter_enabled: true, advisor_enabled: false },
    effectiveConfig: {
      agents: {
        build: primary,
        advisor_reviewer: adviseRoute,
      },
      disabled_providers: [],
    },
    liveCatalog: catalogFor(primary),
  });
  assert.equal(result.state, "resolved");
  assert.equal(result.policy_route.id, "ultra-inherit-build");
  assert.equal(result.policy_route.model, "gpt-5.6-sol");
  assert.equal(result.effective_execution_route.model, "gpt-5.6-sol");
  assertObserveOnly(result);
});

caseOf("input-supplied catalog evidence is used without a provider call", () => {
  let catalogCalls = 0;
  const result = resolvePolicy({
    ...policyInput("build"),
    live_catalog: catalogFor(buildRoute),
  }, {
    manifest,
    local: { policy_adapter_enabled: true, advisor_enabled: false },
    effectiveConfig: effectiveConfig(),
    loadCatalog: () => {
      catalogCalls += 1;
      throw new Error("provider calls are not allowed in deterministic fixtures");
    },
  });
  assert.equal(result.state, "resolved");
  assert.equal(catalogCalls, 0);
  assertObserveOnly(result);
});

caseOf("explicit compatible developer route", () => {
  const developerRoute = {
    provider: "openai",
    model: "gpt-5.6-sol",
    serving_path: "openai",
  };
  const result = resolve("build", {
    input: { developer_selection: developerRoute },
    effectiveConfig: effectiveConfig({ build: developerRoute }),
    effectiveRoute: developerRoute,
    liveCatalog: catalogFor(developerRoute),
  });
  assert.equal(result.state, "resolved");
  assert.equal(result.precedence_source, "developer");
  assert.deepEqual(result.policy_route, { id: "build-terra", ...buildRoute });
  assert.deepEqual(result.developer_selection, developerRoute);
  assert.equal(result.developer_selection.manifest_route_id, undefined);
  assert.deepEqual(result.effective_execution_route, developerRoute);
  assertObserveOnly(result);
});

caseOf("repository restriction conflicts with developer route", () => {
  const developerRoute = { ...buildRoute };
  const result = resolve("build", {
    input: {
      developer_selection: developerRoute,
      repository_restrictions: { prohibited_providers: ["openai"] },
    },
  });
  assert.equal(result.state, "blocked");
  assert.equal(result.precedence_source, "repository");
  assert.equal(result.reason, "restriction_prohibited_provider");
  assert.equal(result.policy_route, undefined);
  assert.deepEqual(result.developer_selection, { ...developerRoute, manifest_route_id: "build-terra" });
  assert.deepEqual(result.effective_execution_route, developerRoute);
  assertObserveOnly(result);
});

caseOf("malformed normalized restriction is unverified", () => {
  const result = resolve("build", {
    input: { repository_restrictions: { allowed_providers: ["open ai"] } },
  });
  assert.equal(result.state, "unverified");
  assert.equal(result.reason, "restrictions_missing");
  assert.equal(result.policy_route, undefined);
  assertObserveOnly(result);
});

caseOf("Advise while locally disabled", () => {
  let catalogCalls = 0;
  const result = resolve("advise", {
    local: { policy_adapter_enabled: true, advisor_enabled: false },
    loadCatalog: () => {
      catalogCalls += 1;
      throw new Error("catalog must not be read");
    },
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.reason, "advisor_disabled");
  assert.match(result.next_action, /Enable the explicit \/advise lane/);
  assert.equal(result.policy_route, undefined);
  assert.equal(catalogCalls, 0);
  assertObserveOnly(result);
});

caseOf("provider/model missing from live catalog", () => {
  const result = resolve("build", {
    liveCatalog: {
      providers: {
        openai: { status: "available", models: {} },
      },
    },
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.catalog.status, "unavailable");
  assert.equal(result.catalog.reason, "model_missing");
  assert.equal(result.fallback.disposition, "developer_action_required");
  assert.doesNotMatch(JSON.stringify(result), /fallback_provider|provider_substitution|selected_provider/iu);
  assertObserveOnly(result);
});

caseOf("missing provider credentials", () => {
  const secret = "Bearer test-secret-that-must-not-escape";
  const error = new Error(secret);
  error.code = "missing_credentials";
  const result = resolve("build", {
    liveCatalog: undefined,
    loadCatalog: () => {
      throw error;
    },
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.catalog.reason, "credentials_missing");
  assert.match(result.next_action, /Authenticate the provider/);
  assert.doesNotMatch(JSON.stringify(result), /test-secret|Bearer/iu);
  assertObserveOnly(result);
});

caseOf("disabled provider or unexpandable effective alias", () => {
  const disabled = resolve("build", {
    effectiveConfig: effectiveConfig({ disabled: ["openai"] }),
  });
  assert.equal(disabled.state, "unavailable");
  assert.equal(disabled.reason, "effective_provider_disabled");
  assert.deepEqual(disabled.effective_execution_route, buildRoute);

  const unexpandable = { provider: "openai", model: "gpt-5.6-unknown", serving_path: "openai" };
  const result = resolve("build", {
    effectiveConfig: effectiveConfig({ build: unexpandable }),
    effectiveRoute: unexpandable,
    liveCatalog: catalogFor(unexpandable),
  });
  assert.equal(result.state, "unavailable");
  assert.equal(result.reason, "effective_alias_missing");
  assert.equal(result.effective_execution_route.model, "gpt-5.6-unknown");
  assert.doesNotMatch(JSON.stringify(result), /gpt-5\.6-terra-xhigh-pinned|xhigh/iu);
  assertObserveOnly(result);
});

caseOf("policy_adapter_enabled false", () => {
  let manifestCalls = 0;
  let catalogCalls = 0;
  const result = resolvePolicyFromSources({
    local: { policy_adapter_enabled: false, advisor_enabled: true },
    input: policyInput("build"),
    loadManifest: () => {
      manifestCalls += 1;
      throw new Error("manifest must not be read");
    },
    loadCatalog: () => {
      catalogCalls += 1;
      throw new Error("catalog must not be read");
    },
  });
  assert.deepEqual(result, {
    state: "disabled",
    adapter_enabled: false,
    execution_altered: false,
  });
  assert.equal(manifestCalls, 0);
  assert.equal(catalogCalls, 0);
});

caseOf("invalid schema or unsupported version", () => {
  assert.throws(
    () => resolve("build", { manifest: { ...manifest, schema_version: 2 } }),
    /schema version is unsupported/,
  );
  assert.throws(
    () => resolve("build", { manifest: { ...manifest, unsupported: true } }),
    /unsupported or missing fields/,
  );
});

caseOf("manifest semantic change", () => {
  const changed = structuredClone(manifest);
  changed.policy_version = 2;
  changed.changelog.push({
    policy_version: 2,
    date: "2026-07-18",
    summary: "Record the current unpinned route identities.",
    evidence_ref: "reports/opencode-model-routing/report.md",
  });
  const parsed = parsePolicyManifest(changed);
  assert.equal(parsed.policy_version, 2);
  assert.notEqual(policyConfigurationHash(parsed), EXPECTED_MANIFEST_HASH);
  assert.match(canonicalJson(parsed), /gpt-5\.6-terra/);
});

caseOf("legacy pinned routing normalizes to the observed unpinned route", () => {
  const migrated = {
    provider: "openai",
    model: "gpt-5.6-terra",
    serving_path: "openai",
  };
  const result = resolve("build", {
    effectiveConfig: effectiveConfig({ build: migrated }),
    effectiveRoute: migrated,
    liveCatalog: catalogFor(migrated),
  });
  assert.equal(result.state, "resolved");
  assert.equal(result.effective_execution_route.model, "gpt-5.6-terra");
  assert.doesNotMatch(JSON.stringify(result), /gpt-5\.6-terra-xhigh-pinned|xhigh/iu);
  assertObserveOnly(result);
});

caseOf("explicit Advise route when locally enabled", () => {
  const result = resolve("advise", {
    local: { policy_adapter_enabled: true, advisor_enabled: true },
    effectiveConfig: effectiveConfig({ advisor: adviseRoute }),
    effectiveRoute: adviseRoute,
    liveCatalog: catalogFor(adviseRoute),
  });
  assert.equal(result.state, "resolved");
  assert.equal(result.policy_route.id, "advise-opus-isolated");
  assert.deepEqual(result.policy_route, { id: "advise-opus-isolated", ...adviseRoute });
  assert.equal(result.controls.continuation, "none");
  assert.equal(result.controls.independent_review, "isolated_read_only");
  assertObserveOnly(result);
});

caseOf("runtime effort metadata is reported only when exposed", () => {
  const route = { ...buildRoute, reasoning_effort: "high" };
  const result = resolve("build", {
    effectiveConfig: effectiveConfig({ build: route }),
    effectiveRoute: route,
    liveCatalog: catalogFor(route, { effort: "high" }),
  });
  assert.equal(result.state, "resolved");
  assert.equal(result.effective_execution_route.reasoning_effort, "high");
  assert.equal(result.route_metadata.reasoning_effort, "available");
  assertObserveOnly(result);
});

caseOf("effective advisor variant is reported rather than hidden", () => {
  const result = resolvePolicy(policyInput("advise"), {
    manifest,
    local: { policy_adapter_enabled: true, advisor_enabled: true },
    effectiveConfig: {
      agents: {
        advisor_reviewer: {
          model: "anthropic/claude-opus-4-8",
          variant: "high",
        },
      },
      disabled_providers: [],
    },
    liveCatalog: {
      providers: {
        anthropic: {
          status: "available",
          models: { "claude-opus-4-8": { serving_path: "anthropic", reasoning_effort: "high" } },
        },
      },
    },
  });
  assert.equal(result.state, "resolved");
  assert.equal(result.effective_execution_route.reasoning_effort, "high");
  assert.equal(result.route_metadata.reasoning_effort, "available");
  assertObserveOnly(result);
});

const observationRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-policy-observation-test-"));
try {
  const result = resolve("build");
  const observedAt = new Date("2026-07-18T12:00:00.000Z");
  const record = recordPolicyObservation({
    resolution: result,
    directory: observationRoot,
    observedAt,
  });
  assert.equal(record.observed_at, observedAt.toISOString());
  assert.deepEqual(readPolicyObservation(observationRoot), record);
  assert.equal(fs.statSync(path.join(observationRoot, "latest.json")).mode & 0o077, 0);
  assert.equal(fs.statSync(observationRoot).mode & 0o077, 0);
  const redacted = redactPolicyResolution({
    ...result,
    developer_selection: {
      provider: "openai",
      model: "accounts/private-account/models/secret-model",
      serving_path: "openai",
    },
    fallback: { disposition: "developer_action_required", message: "Bearer secret" },
    catalog: { status: "unavailable", reason: "Bearer secret" },
  });
  assert.equal(redacted.developer_selection.model, "redacted");
  assert.equal(redacted.fallback.message, "[redacted]");
  assert.equal(redacted.catalog.reason, "[redacted]");
  assert.doesNotMatch(JSON.stringify(record), /private-account|secret/iu);
  const observationPath = path.join(observationRoot, "latest.json");
  const originalRecord = JSON.parse(fs.readFileSync(observationPath, "utf8"));
  for (const [name, mutate, expectedError] of [
    [
      "raw catalog output",
      (value) => { value.resolution.catalog.raw_output = "Bearer leaked-secret"; },
      /unsupported fields/,
    ],
    [
      "catalog reason",
      (value) => { value.resolution.catalog.reason = "Bearer leaked-secret"; },
      /catalog.reason is unsupported/,
    ],
    ["state", (value) => { value.resolution.state = "unavailable"; }, /integrity check failed/],
    [
      "configuration hash",
      (value) => { value.resolution.configuration_hash = `sha256:${"0".repeat(64)}`; },
      /integrity check failed/,
    ],
    ["fallback message", (value) => { value.resolution.fallback.message = "Bearer leaked-secret"; }, /unredacted fields/],
  ]) {
    const tampered = structuredClone(originalRecord);
    mutate(tampered);
    fs.writeFileSync(observationPath, JSON.stringify(tampered));
    assert.throws(() => readPolicyObservation(observationRoot), expectedError, name);
  }
} finally {
  fs.rmSync(observationRoot, { recursive: true, force: true });
}

const cliRoot = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-policy-cli-test-"));
try {
  const inputPath = path.join(cliRoot, "input.json");
  const observationDirectory = path.join(cliRoot, "observations");
  fs.writeFileSync(
    inputPath,
    JSON.stringify({
      ...policyInput("build"),
      effective_config: effectiveConfig(),
      live_catalog: catalogFor(buildRoute),
    }),
  );
  const cli = Bun.spawnSync([
    "bun",
    path.join(repoRoot, "scripts", "resolve-opencode-policy.mjs"),
    repoRoot,
    cliRoot,
    "--input",
    inputPath,
  ], {
    env: { ...process.env, OPENCODE_POLICY_OBSERVATION_DIR: observationDirectory },
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.equal(cli.exitCode, 0, cli.stderr.toString());
  const cliRecord = JSON.parse(cli.stdout.toString());
  assert.equal(cliRecord.resolution.state, "resolved");
  assert.equal(cliRecord.resolution.execution_altered, false);
  const query = Bun.spawnSync([
    "bun",
    path.join(repoRoot, "scripts", "resolve-opencode-policy.mjs"),
    repoRoot,
    cliRoot,
    "--query",
  ], {
    env: { ...process.env, OPENCODE_POLICY_OBSERVATION_DIR: observationDirectory },
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.equal(query.exitCode, 0, query.stderr.toString());
  assert.deepEqual(JSON.parse(query.stdout.toString()), cliRecord);

  const inheritedConfigDir = path.join(cliRoot, "inherited-config");
  fs.mkdirSync(inheritedConfigDir);
  fs.writeFileSync(
    path.join(inheritedConfigDir, "opencode.json"),
    JSON.stringify({ model: "openai/gpt-5.6-terra", agent: { build: {}, ultra: {} } }),
  );
  const inheritedInputPath = path.join(cliRoot, "inherited-input.json");
  fs.writeFileSync(
    inheritedInputPath,
    JSON.stringify({ ...policyInput("ultra"), live_catalog: catalogFor(buildRoute) }),
  );
  const inheritedCli = Bun.spawnSync([
    "bun",
    path.join(repoRoot, "scripts", "resolve-opencode-policy.mjs"),
    repoRoot,
    inheritedConfigDir,
    "--input",
    inheritedInputPath,
    "--no-observe",
  ], {
    env: { ...process.env, OPENCODE_POLICY_OBSERVATION_DIR: observationDirectory },
    stdout: "pipe",
    stderr: "pipe",
  });
  assert.equal(inheritedCli.exitCode, 0, inheritedCli.stderr.toString());
  const inheritedResult = JSON.parse(inheritedCli.stdout.toString());
  assert.equal(inheritedResult.state, "resolved");
  assert.equal(inheritedResult.policy_route.model, "gpt-5.6-terra");
  assert.equal(inheritedResult.effective_execution_route.model, "gpt-5.6-terra");

  const disabledConfigDir = path.join(cliRoot, "disabled-config");
  fs.mkdirSync(disabledConfigDir);
  fs.writeFileSync(
    path.join(disabledConfigDir, "model-routing.config.local.json"),
    JSON.stringify({ policy_adapter_enabled: false }),
  );
  const disabledCli = Bun.spawnSync([
    "bun",
    path.join(repoRoot, "scripts", "resolve-opencode-policy.mjs"),
    path.join(cliRoot, "missing-repository"),
    disabledConfigDir,
    "--validate",
  ], { stdout: "pipe", stderr: "pipe" });
  assert.equal(disabledCli.exitCode, 0, disabledCli.stderr.toString());
  assert.deepEqual(JSON.parse(disabledCli.stdout.toString()), {
    state: "disabled",
    adapter_enabled: false,
    execution_altered: false,
  });
} finally {
  fs.rmSync(cliRoot, { recursive: true, force: true });
}

assert.equal(policyConfigurationHash(parsePolicyManifest(manifest)), EXPECTED_MANIFEST_HASH);
assert.equal(inspectPolicyInstallation({ repoRoot, configDir: os.tmpdir() }).adapter_enabled, true);

for (const { name, test } of cases) {
  test();
  console.log(`OK     ${name}`);
}
console.log(`OK     ${cases.length} deterministic policy resolver fixtures`);
