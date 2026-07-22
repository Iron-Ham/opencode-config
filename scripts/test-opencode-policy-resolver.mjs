#!/usr/bin/env bun

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  canonicalJson,
  createPolicyDecisionReceipt,
  inspectPolicyInstallation,
  parsePolicyManifest,
  parsePolicyDecisionReceipt,
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
const EXPECTED_MANIFEST_HASH = "sha256:f66bbf843ec26c0eaa5d6aee70bae862bef8459715e3baeacd7785aa3a181ed7";
const buildRoute = {
  provider: "openai",
  model: "gpt-5.6-terra",
  serving_path: "openai",
};
function policyInput(mode, overrides = {}) {
  return {
    mode,
    repository_restrictions: {},
    characteristics: {
      boundedness: "normal_production",
      verification_strength: "deterministic",
      production_risk: "normal",
      unattended_authorized: false,
    },
    ...overrides,
  };
}

function effectiveConfig({ build = buildRoute, disabled = [] } = {}) {
  return {
    disabled_providers: disabled,
    agents: {
      build,
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
  const route = options.effectiveRoute ?? buildRoute;
  const effective = options.effectiveConfig ?? effectiveConfig({
    build: mode === "build" ? route : buildRoute,
  });
  return resolvePolicy(input, {
    manifest: options.manifest ?? manifest,
    local: options.local ?? { policy_adapter_enabled: true },
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

caseOf("retired command-only modes are rejected", () => {
  for (const mode of ["advise", "ultra"]) {
    assert.throws(() => resolve(mode), /mode is unsupported/);
  }
});

caseOf("input-supplied catalog evidence is used without a provider call", () => {
  let catalogCalls = 0;
  const result = resolvePolicy({
    ...policyInput("build"),
    live_catalog: catalogFor(buildRoute),
  }, {
    manifest,
    local: { policy_adapter_enabled: true },
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
    local: { policy_adapter_enabled: false },
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

caseOf("redacted decision receipts", () => {
  const observedAt = new Date("2026-07-18T12:00:00.000Z");
  const allow = createPolicyDecisionReceipt(resolve("build"), { observedAt });
  assert.equal(allow.decision, "allow");
  assert.equal(allow.route_id, "build-terra");
  assert.equal(allow.declared_inputs.developer_selection, false);
  assert.equal(allow.configuration_hash.startsWith("sha256:"), true);

  const overridden = createPolicyDecisionReceipt(resolve("build", {
    input: { developer_selection: { provider: "openai", model: "gpt-5.6-sol", serving_path: "openai" } },
    effectiveConfig: effectiveConfig({ build: { provider: "openai", model: "gpt-5.6-sol", serving_path: "openai" } }),
    effectiveRoute: { provider: "openai", model: "gpt-5.6-sol", serving_path: "openai" },
    liveCatalog: catalogFor({ provider: "openai", model: "gpt-5.6-sol", serving_path: "openai" }),
  }), { observedAt });
  assert.equal(overridden.decision, "overridden");
  assert.equal(overridden.declared_inputs.developer_selection, true);
  assert.doesNotMatch(JSON.stringify(overridden), /private-account|Bearer|secret/iu);

  const blocked = createPolicyDecisionReceipt(resolve("build", {
    input: { repository_restrictions: { prohibited_providers: ["openai"] } },
  }), { observedAt });
  assert.equal(blocked.decision, "block");

  const unavailable = createPolicyDecisionReceipt(resolve("build", {
    liveCatalog: { providers: { openai: { status: "available", models: {} } } },
  }), { observedAt });
  assert.equal(unavailable.decision, "unavailable");

  const disabled = createPolicyDecisionReceipt(resolvePolicy(policyInput("build"), {
    manifest,
    local: { policy_adapter_enabled: false },
  }), { observedAt });
  assert.equal(disabled.decision, "adapter_disabled");
  assert.equal(disabled.policy_version, null);
  assert.equal(disabled.configuration_hash, null);

  const warn = structuredClone(allow);
  warn.decision = "warn";
  warn.rule_id = "catalog-unverified";
  warn.reason_code = "catalog_unverified";
  warn.receipt_id = `sha256:${createHash("sha256").update(canonicalJson(((receipt) => { const { receipt_id, ...payload } = receipt; return payload; })(warn)), "utf8").digest("hex")}`;
  assert.equal(parsePolicyDecisionReceipt(warn).decision, "warn");

  const malformed = structuredClone(allow);
  malformed.declared_inputs = { developer_selection: false, raw_path: "/private" };
  assert.throws(() => parsePolicyDecisionReceipt(malformed), /unsupported or missing fields/);
  assert.equal(resolve("build").execution_altered, false);
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
  changed.policy_version = 4;
  changed.changelog.push({
    policy_version: 4,
    date: "2026-07-18",
    summary: "Record the current unpinned route identities.",
    evidence_ref: "reports/opencode-model-routing/report.md",
  });
  const parsed = parsePolicyManifest(changed);
  assert.equal(parsed.policy_version, 4);
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
  const emailRoute = {
    provider: "openai",
    model: "alice@example.com",
    serving_path: "openai",
  };
  const emailRedacted = redactPolicyResolution({ ...result, developer_selection: emailRoute });
  assert.equal(emailRedacted.developer_selection.model, "redacted");
  const accountRoute = {
    provider: "tenant-492",
    model: "tenant-acme-492",
    serving_path: "tenant-492",
  };
  const accountRedacted = redactPolicyResolution({
    ...result,
    developer_selection: accountRoute,
    effective_execution_route: accountRoute,
  });
  assert.equal(accountRedacted.developer_selection.model, "redacted");
  assert.equal(accountRedacted.developer_selection.serving_path, "redacted");
  assert.equal(accountRedacted.effective_execution_route.model, "redacted");
  const accountRecord = recordPolicyObservation({
    resolution: { ...result, developer_selection: accountRoute, effective_execution_route: accountRoute },
    directory: observationRoot,
    observedAt,
  });
  assert.doesNotMatch(JSON.stringify(accountRecord), /tenant-492|tenant-acme-492/iu);
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

  const overriddenConfigDir = path.join(cliRoot, "overridden-config");
  fs.mkdirSync(overriddenConfigDir);
  fs.writeFileSync(
    path.join(overriddenConfigDir, "opencode.json"),
    JSON.stringify({ agent: { build: { model: "openai/gpt-5.6-sol" } } }),
  );
  fs.writeFileSync(
    path.join(overriddenConfigDir, "model-routing.config.local.json"),
    JSON.stringify({ agents: { build: "openai/gpt-5.6-sol" } }),
  );
  const overriddenRoute = {
    provider: "openai",
    model: "gpt-5.6-sol",
    serving_path: "openai",
  };
  for (const mode of ["build"]) {
    const overrideInputPath = path.join(cliRoot, `overridden-${mode}-input.json`);
    fs.writeFileSync(
      overrideInputPath,
      JSON.stringify({ ...policyInput(mode), live_catalog: catalogFor(overriddenRoute) }),
    );
    const overrideCli = Bun.spawnSync([
      "bun",
      path.join(repoRoot, "scripts", "resolve-opencode-policy.mjs"),
      repoRoot,
      overriddenConfigDir,
      "--input",
      overrideInputPath,
      "--no-observe",
    ], { stdout: "pipe", stderr: "pipe" });
    assert.equal(overrideCli.exitCode, 0, overrideCli.stderr.toString());
    const overrideResult = JSON.parse(overrideCli.stdout.toString());
    assert.equal(overrideResult.precedence_source, "developer");
    assert.deepEqual(overrideResult.developer_selection, overriddenRoute);
    assert.deepEqual(overrideResult.effective_execution_route, overriddenRoute);
  }
  const suppliedEffectiveInputPath = path.join(cliRoot, "overridden-supplied-effective-input.json");
  fs.writeFileSync(
    suppliedEffectiveInputPath,
    JSON.stringify({
      input: policyInput("build"),
      effective_config: effectiveConfig({ build: overriddenRoute }),
      live_catalog: catalogFor(overriddenRoute),
    }),
  );
  const suppliedEffectiveCli = Bun.spawnSync([
    "bun",
    path.join(repoRoot, "scripts", "resolve-opencode-policy.mjs"),
    repoRoot,
    overriddenConfigDir,
    "--input",
    suppliedEffectiveInputPath,
    "--no-observe",
  ], { stdout: "pipe", stderr: "pipe" });
  assert.equal(suppliedEffectiveCli.exitCode, 0, suppliedEffectiveCli.stderr.toString());
  const suppliedEffectiveResult = JSON.parse(suppliedEffectiveCli.stdout.toString());
  assert.equal(suppliedEffectiveResult.precedence_source, "developer");
  assert.deepEqual(suppliedEffectiveResult.developer_selection, overriddenRoute);

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
