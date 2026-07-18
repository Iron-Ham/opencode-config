#!/usr/bin/env bun

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";

const SUPPORTED_MODES = new Set(["build", "ultra", "advise"]);
const MODE_AGENTS = {
  build: "build",
  ultra: "ultra",
  advise: "advisor_reviewer",
};
const CHARACTERISTIC_ENUMS = {
  boundedness: new Set(["bounded_verifiable", "normal_production", "premium_quality"]),
  verification_strength: new Set(["weak", "deterministic", "runtime"]),
  production_risk: new Set(["bounded", "normal", "high"]),
};
const CONTROL_ENUMS = {
  continuation: new Set(["ordinary_open_code", "durable_goal_only", "none"]),
  compaction: new Set(["gpt_256k_with_20k_reserve", "ordinary_open_code", "none"]),
  delegation: new Set(["bounded_by_agent_policy", "bounded_by_ultra_policy", "none"]),
  independent_review: new Set(["developer_explicit_only", "isolated_read_only"]),
};
const FALLBACK_DISPOSITION = "developer_action_required";
const DEFAULT_FALLBACK_MESSAGE =
  "Choose an allowed exact route; the policy adapter will not substitute one.";
const OBSERVATION_SCHEMA_VERSION = 1;
const DECISION_RECEIPT_SCHEMA_VERSION = 1;
const RECEIPT_DECISIONS = new Set([
  "allow",
  "warn",
  "block",
  "overridden",
  "unavailable",
  "unverified",
  "no_managed_route",
  "adapter_disabled",
]);
const REASONING_EFFORT_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/u;
const ROUTE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const PROVIDER_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/u;
const OBSERVABLE_ROUTE_IDENTITIES = new Set([
  "openai\u0000gpt-5.6-terra\u0000openai",
  "openai\u0000gpt-5.6-sol\u0000openai",
  "anthropic\u0000claude-opus-4-8\u0000anthropic",
]);
const SAFE_STRING_MAX = 512;
const POLICY_REASON_CODES = new Set([
  "managed_route_available",
  "developer_route_available",
  "advisor_disabled",
  "restrictions_missing",
  "restriction_prohibited_provider",
  "restriction_provider_not_allowed",
  "restriction_prohibited_route",
  "restriction_route_identity_unverified",
  "restriction_route_not_allowed",
  "restriction_data_egress_denied",
  "restriction_data_egress_provider_mismatch",
  "effective_provider_disabled",
  "effective_alias_missing",
  "effective_route_unverified",
  "catalog_unverified",
  "provider_missing",
  "provider_unavailable",
  "credentials_missing",
  "model_missing",
  "serving_path_unverified",
  "reasoning_effort_unverified",
  "route_identity_mismatch",
  "no_managed_route",
  "developer_route_unverified",
]);

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message, scope = "input") {
  const error = new Error(message);
  error.policyScope = scope;
  throw error;
}

function assertPlainObject(value, label, scope = "input") {
  if (!isPlainObject(value)) fail(`${label} must be an object`, scope);
}

function assertExactKeys(value, keys, label, scope = "input") {
  assertPlainObject(value, label, scope);
  const expected = new Set(keys);
  const actual = Object.keys(value);
  if (actual.length !== expected.size || actual.some((key) => !expected.has(key))) {
    fail(`${label} contains unsupported or missing fields`, scope);
  }
}

function assertAllowedKeys(value, keys, label, scope = "input") {
  assertPlainObject(value, label, scope);
  const expected = new Set(keys);
  if (Object.keys(value).some((key) => !expected.has(key))) {
    fail(`${label} contains unsupported fields`, scope);
  }
}

function assertNonEmptyString(value, label, { pattern, max = SAFE_STRING_MAX } = {}, scope = "input") {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.length > max ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    (pattern && !pattern.test(value))
  ) {
    fail(`${label} must be a safe non-empty string`, scope);
  }
}

function assertPositiveInteger(value, label, scope = "input") {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail(`${label} must be a positive integer`, scope);
  }
}

function assertUniqueStrings(values, label, scope = "input") {
  if (!Array.isArray(values) || values.length === 0) {
    fail(`${label} must be a non-empty string array`, scope);
  }
  const seen = new Set();
  for (const value of values) {
    assertNonEmptyString(value, `${label} entry`, {}, scope);
    if (seen.has(value)) fail(`${label} must not contain duplicates`, scope);
    seen.add(value);
  }
}

function assertExactRoute(route, label = "route", scope = "input") {
  assertAllowedKeys(route, ["provider", "model", "serving_path", "reasoning_effort"], label, scope);
  for (const field of ["provider", "model", "serving_path"]) {
    if (!Object.hasOwn(route, field)) fail(`${label}.${field} is required`, scope);
  }
  assertNonEmptyString(route.provider, `${label}.provider`, { pattern: PROVIDER_PATTERN }, scope);
  assertNonEmptyString(route.model, `${label}.model`, {}, scope);
  assertNonEmptyString(route.serving_path, `${label}.serving_path`, {}, scope);
  if (route.reasoning_effort !== undefined) {
    assertNonEmptyString(
      route.reasoning_effort,
      `${label}.reasoning_effort`,
      { pattern: REASONING_EFFORT_PATTERN },
      scope,
    );
  }
}

function copyRoute(route) {
  const copy = {
    provider: route.provider,
    model: route.model,
    serving_path: route.serving_path,
  };
  if (route.reasoning_effort !== undefined) copy.reasoning_effort = route.reasoning_effort;
  return copy;
}

function sameRoute(left, right) {
  return Boolean(left && right) &&
    left.provider === right.provider &&
    left.model === right.model &&
    left.serving_path === right.serving_path &&
    (left.reasoning_effort === undefined ||
      right.reasoning_effort === undefined ||
      left.reasoning_effort === right.reasoning_effort);
}

function routeKey(route) {
  return [route.provider, route.model, route.serving_path, route.reasoning_effort ?? ""].join("\u0000");
}

function validateControls(controls, label) {
  assertExactKeys(
    controls,
    ["continuation", "compaction", "delegation", "independent_review"],
    label,
    "manifest",
  );
  for (const [field, values] of Object.entries(CONTROL_ENUMS)) {
    if (typeof controls[field] !== "string" || !values.has(controls[field])) {
      fail(`${label}.${field} contains an unsupported value`, "manifest");
    }
  }
}

function validateManifest(manifest) {
  assertExactKeys(
    manifest,
    ["schema_version", "policy_version", "changelog", "routes", "deprecation"],
    "manifest",
    "manifest",
  );
  if (manifest.schema_version !== 1) fail("manifest schema version is unsupported", "manifest");
  assertPositiveInteger(manifest.policy_version, "manifest.policy_version", "manifest");

  if (!Array.isArray(manifest.changelog) || manifest.changelog.length === 0) {
    fail("manifest.changelog must be a non-empty array", "manifest");
  }
  let hasCurrentChangelog = false;
  for (const [index, entry] of manifest.changelog.entries()) {
    const label = `manifest.changelog[${index}]`;
    assertExactKeys(entry, ["policy_version", "date", "summary", "evidence_ref"], label, "manifest");
    assertPositiveInteger(entry.policy_version, `${label}.policy_version`, "manifest");
    assertNonEmptyString(entry.date, `${label}.date`, { max: 10 }, "manifest");
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(entry.date) || Number.isNaN(Date.parse(`${entry.date}T00:00:00Z`))) {
      fail(`${label}.date must be an ISO calendar date`, "manifest");
    }
    assertNonEmptyString(entry.summary, `${label}.summary`, {}, "manifest");
    assertNonEmptyString(entry.evidence_ref, `${label}.evidence_ref`, {}, "manifest");
    if (entry.policy_version === manifest.policy_version) hasCurrentChangelog = true;
  }
  if (!hasCurrentChangelog) fail("manifest.changelog must retain the current policy version", "manifest");

  if (!Array.isArray(manifest.routes) || manifest.routes.length === 0) {
    fail("manifest.routes must be a non-empty array", "manifest");
  }
  const routeIDs = new Set();
  const matchedModes = new Set();
  for (const [index, route] of manifest.routes.entries()) {
    const label = `manifest.routes[${index}]`;
    assertExactKeys(route, ["id", "match", "execution", "controls", "fallback"], label, "manifest");
    assertNonEmptyString(route.id, `${label}.id`, { pattern: ROUTE_ID_PATTERN }, "manifest");
    if (routeIDs.has(route.id)) fail("manifest route IDs must be unique", "manifest");
    routeIDs.add(route.id);

    assertExactKeys(route.match, ["modes"], `${label}.match`, "manifest");
    assertUniqueStrings(route.match.modes, `${label}.match.modes`, "manifest");
    for (const mode of route.match.modes) {
      if (!SUPPORTED_MODES.has(mode)) fail(`${label}.match contains an unsupported mode`, "manifest");
      if (matchedModes.has(mode)) fail("manifest mode matches must be unambiguous", "manifest");
      matchedModes.add(mode);
    }

    if (isPlainObject(route.execution) && Object.hasOwn(route.execution, "inherits_route_id")) {
      assertExactKeys(route.execution, ["inherits_route_id"], `${label}.execution`, "manifest");
      assertNonEmptyString(
        route.execution.inherits_route_id,
        `${label}.execution.inherits_route_id`,
        { pattern: ROUTE_ID_PATTERN },
        "manifest",
      );
    } else {
      assertExactRoute(route.execution, `${label}.execution`, "manifest");
    }

    validateControls(route.controls, `${label}.controls`);
    assertExactKeys(route.fallback, ["disposition", "message"], `${label}.fallback`, "manifest");
    if (route.fallback.disposition !== FALLBACK_DISPOSITION) {
      fail(`${label}.fallback.disposition is unsupported`, "manifest");
    }
    assertNonEmptyString(route.fallback.message, `${label}.fallback.message`, {}, "manifest");
  }

  if (!Array.isArray(manifest.deprecation)) {
    fail("manifest.deprecation must be an array", "manifest");
  }
  for (const [index, record] of manifest.deprecation.entries()) {
    const label = `manifest.deprecation[${index}]`;
    assertExactKeys(
      record,
      ["route_id", "replacement_route_id", "effective_policy_version", "reason"],
      label,
      "manifest",
    );
    assertNonEmptyString(record.route_id, `${label}.route_id`, { pattern: ROUTE_ID_PATTERN }, "manifest");
    if (record.replacement_route_id !== null) {
      assertNonEmptyString(
        record.replacement_route_id,
        `${label}.replacement_route_id`,
        { pattern: ROUTE_ID_PATTERN },
        "manifest",
      );
    }
    assertPositiveInteger(record.effective_policy_version, `${label}.effective_policy_version`, "manifest");
    if (record.effective_policy_version > manifest.policy_version) {
      fail(`${label}.effective_policy_version cannot be in the future`, "manifest");
    }
    assertNonEmptyString(record.reason, `${label}.reason`, {}, "manifest");
  }

  for (const route of manifest.routes) {
    if (
      isPlainObject(route.execution) &&
      Object.hasOwn(route.execution, "inherits_route_id") &&
      !routeIDs.has(route.execution.inherits_route_id)
    ) {
      fail("manifest inheritance target is missing", "manifest");
    }
  }
  for (const record of manifest.deprecation) {
    if (!routeIDs.has(record.route_id)) fail("manifest deprecation route is missing", "manifest");
    if (record.replacement_route_id !== null && !routeIDs.has(record.replacement_route_id)) {
      fail("manifest deprecation replacement route is missing", "manifest");
    }
  }

  const routeByID = new Map(manifest.routes.map((route) => [route.id, route]));
  const visiting = new Set();
  const visited = new Set();
  function visit(routeID) {
    if (visited.has(routeID)) return;
    if (visiting.has(routeID)) fail("manifest inheritance contains a cycle", "manifest");
    visiting.add(routeID);
    const route = routeByID.get(routeID);
    if (Object.hasOwn(route.execution, "inherits_route_id")) visit(route.execution.inherits_route_id);
    visiting.delete(routeID);
    visited.add(routeID);
  }
  for (const route of manifest.routes) visit(route.id);

  return structuredClone(manifest);
}

export function parsePolicyManifest(manifest) {
  return validateManifest(manifest);
}

function codePointCompare(left, right) {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index += 1) {
    const leftPoint = leftPoints[index].codePointAt(0);
    const rightPoint = rightPoints[index].codePointAt(0);
    if (leftPoint !== rightPoint) return leftPoint - rightPoint;
  }
  return leftPoints.length - rightPoints.length;
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(codePointCompare)
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

export function policyConfigurationHash(manifest) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(manifest), "utf8").digest("hex")}`;
}

function expandRoute(routeID, manifest, stack = new Set()) {
  if (stack.has(routeID)) fail("manifest inheritance contains a cycle", "manifest");
  const route = manifest.routes.find((candidate) => candidate.id === routeID);
  if (!route) fail("manifest route is missing", "manifest");
  if (!Object.hasOwn(route.execution, "inherits_route_id")) return copyRoute(route.execution);
  stack.add(routeID);
  const expanded = expandRoute(route.execution.inherits_route_id, manifest, stack);
  stack.delete(routeID);
  return expanded;
}

function routeForMode(manifest, mode) {
  const route = manifest.routes.find((candidate) => candidate.match.modes.includes(mode));
  if (!route) return undefined;
  return {
    id: route.id,
    route: expandRoute(route.id, manifest),
    controls: structuredClone(route.controls),
    fallback: structuredClone(route.fallback),
  };
}

function manifestRouteForIdentity(manifest, mode, route) {
  const modeRoute = routeForMode(manifest, mode);
  if (modeRoute && sameRoute(modeRoute.route, route)) return modeRoute.id;
  return undefined;
}

function parseProviderModel(value, label, scope = "input") {
  assertNonEmptyString(value, label, {}, scope);
  const separator = value.indexOf("/");
  if (separator <= 0 || separator === value.length - 1) {
    fail(`${label} must be a provider/model string`, scope);
  }
  const provider = value.slice(0, separator);
  const model = value.slice(separator + 1);
  assertNonEmptyString(provider, `${label} provider`, { pattern: PROVIDER_PATTERN }, scope);
  assertNonEmptyString(model, `${label} model`, {}, scope);
  return { provider, model };
}

function parseDeveloperSelection(value) {
  assertExactRoute(value, "developer_selection", "input");
  return copyRoute(value);
}

function parseRestrictions(value) {
  if (!isPlainObject(value)) fail("repository_restrictions must be an object", "restriction");
  assertAllowedKeys(
    value,
    [
      "allowed_providers",
      "allowed_routes",
      "prohibited_providers",
      "prohibited_routes",
      "data_egress",
    ],
    "repository_restrictions",
    "restriction",
  );
  const normalized = {};
  for (const field of [
    "allowed_providers",
    "allowed_routes",
    "prohibited_providers",
    "prohibited_routes",
  ]) {
    if (value[field] === undefined) continue;
    assertUniqueStrings(value[field], `repository_restrictions.${field}`, "restriction");
    const pattern = field.endsWith("providers") ? PROVIDER_PATTERN : ROUTE_ID_PATTERN;
    if (value[field].some((entry) => !pattern.test(entry))) {
      fail(`repository_restrictions.${field} contains an invalid identity`, "restriction");
    }
    normalized[field] = [...value[field]];
  }
  if (value.data_egress !== undefined) {
    assertAllowedKeys(
      value.data_egress,
      ["disposition", "provider", "serving_path"],
      "repository_restrictions.data_egress",
      "restriction",
    );
    if (!new Set(["allow", "deny", "provider-pinned"]).has(value.data_egress.disposition)) {
      fail("repository_restrictions.data_egress.disposition is unsupported", "restriction");
    }
    if (value.data_egress.provider !== undefined) {
      assertNonEmptyString(
        value.data_egress.provider,
        "repository_restrictions.data_egress.provider",
        { pattern: PROVIDER_PATTERN },
        "restriction",
      );
    }
    if (value.data_egress.serving_path !== undefined) {
      assertNonEmptyString(
        value.data_egress.serving_path,
        "repository_restrictions.data_egress.serving_path",
        {},
        "restriction",
      );
    }
    if (value.data_egress.disposition === "provider-pinned" &&
      (value.data_egress.provider === undefined || value.data_egress.serving_path === undefined)) {
      fail("provider-pinned egress requires provider and serving_path", "restriction");
    }
    if (value.data_egress.disposition !== "provider-pinned" &&
      (value.data_egress.provider !== undefined || value.data_egress.serving_path !== undefined)) {
      fail("only provider-pinned egress may declare provider and serving_path", "restriction");
    }
    normalized.data_egress = { ...value.data_egress };
  }
  return normalized;
}

function normalizePolicyInput(input) {
  assertPlainObject(input, "policy input", "input");
  assertAllowedKeys(
    input,
    ["mode", "developer_selection", "repository_restrictions", "characteristics", "live_catalog"],
    "policy input",
    "input",
  );
  if (!SUPPORTED_MODES.has(input.mode)) fail("policy input mode is unsupported", "input");
  if (input.developer_selection !== undefined && input.developer_selection !== null) {
    input = { ...input, developer_selection: parseDeveloperSelection(input.developer_selection) };
  } else if (input.developer_selection === null) {
    fail("developer_selection must be omitted when absent", "input");
  }
  assertExactKeys(
    input.characteristics,
    ["boundedness", "verification_strength", "production_risk", "unattended_authorized"],
    "policy input characteristics",
    "input",
  );
  for (const [field, values] of Object.entries(CHARACTERISTIC_ENUMS)) {
    if (typeof input.characteristics[field] !== "string" || !values.has(input.characteristics[field])) {
      fail(`policy input characteristics.${field} is unsupported`, "input");
    }
  }
  if (typeof input.characteristics.unattended_authorized !== "boolean") {
    fail("policy input characteristics.unattended_authorized must be a boolean", "input");
  }

  let restrictions;
  let restrictionError;
  try {
    restrictions = parseRestrictions(input.repository_restrictions);
  } catch (error) {
    if (error.policyScope !== "restriction") throw error;
    restrictionError = error;
  }
  return {
    mode: input.mode,
    developer_selection: input.developer_selection === undefined
      ? undefined
      : copyRoute(input.developer_selection),
    characteristics: structuredClone(input.characteristics),
    repository_restrictions: restrictions,
    restriction_error: restrictionError,
    live_catalog: input.live_catalog,
  };
}

export function validatePolicyInput(input) {
  return normalizePolicyInput(input);
}

function routeFromValue(value, label = "effective route") {
  if (!isPlainObject(value)) return { status: "missing" };
  const candidate = isPlainObject(value.route) ? value.route : value;
  let provider = candidate.provider;
  let model = candidate.model;
  if (typeof candidate.providerID === "string" && typeof candidate.modelID === "string") {
    provider = candidate.providerID;
    model = candidate.modelID;
  }
  if (typeof candidate.model === "string" && candidate.model.includes("/") && provider === undefined) {
    const parsed = parseProviderModel(candidate.model, `${label}.model`, "effective");
    provider = parsed.provider;
    model = parsed.model;
  }
  if (typeof provider !== "string" || typeof model !== "string") return { status: "missing" };
  if (!PROVIDER_PATTERN.test(provider) || !model || /[\u0000-\u001f\u007f\s]/u.test(model)) {
    return { status: "unverified" };
  }
  // OpenCode exposes the provider namespace as the serving path when no
  // separate serving-path field is present in the effective configuration.
  const servingPath = candidate.serving_path ?? candidate.servingPath ?? provider;
  const reasoningEffort = candidate.reasoning_effort ??
    candidate.reasoningEffort ??
    candidate.variant ??
    candidate.options?.reasoningEffort;
  const partial = { provider, model };
  if (typeof servingPath === "string") partial.serving_path = servingPath;
  if (typeof reasoningEffort === "string") partial.reasoning_effort = reasoningEffort;
  const hasExact =
    typeof partial.serving_path === "string" &&
    partial.serving_path.length > 0 &&
    !/[\u0000-\u001f\u007f\s]/u.test(partial.serving_path) &&
    (partial.reasoning_effort === undefined || REASONING_EFFORT_PATTERN.test(partial.reasoning_effort));
  return hasExact
    ? { status: "resolved", route: copyRoute(partial) }
    : { status: "unverified", partial };
}

function normalizeEffectiveConfig(value, mode) {
  if (!isPlainObject(value)) return { status: "missing", agents: {} };
  const agents = isPlainObject(value.agents)
    ? value.agents
    : isPlainObject(value.agent)
    ? value.agent
    : {};
  const result = { status: "resolved", agents: {}, disabled_providers: [] };
  if (Array.isArray(value.disabled_providers)) {
    result.disabled_providers = value.disabled_providers.filter((provider) => typeof provider === "string");
  }
  for (const [agentName, entry] of Object.entries(agents)) {
    result.agents[agentName] = routeFromValue(entry, `effective_config.${agentName}`);
  }
  if (
    mode === "build" &&
    (!result.agents.build || result.agents.build.status === "missing") &&
    typeof value.model === "string"
  ) {
    result.agents.build = routeFromValue({ model: value.model }, "effective_config.model");
  }
  const agentName = MODE_AGENTS[mode];
  if (mode === "ultra" && (!result.agents.ultra || result.agents.ultra.status === "missing")) {
    const invokingPrimary = value.invoking_primary !== undefined
      ? routeFromValue(value.invoking_primary, "effective_config.invoking_primary")
      : result.agents.build ?? { status: "missing" };
    result.agents.ultra = structuredClone(invokingPrimary);
  }
  return {
    ...result,
    agent: agentName,
    route: result.agents[agentName] ?? { status: "missing" },
  };
}

function effectiveRouteFromConfigFile(configDir, mode) {
  const filePath = path.join(configDir, "opencode.json");
  if (!fs.existsSync(filePath)) return { status: "missing", agents: {} };
  let config;
  try {
    config = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return { status: "unverified", agents: {} };
  }
  const agents = {};
  for (const [modeName, agentName] of Object.entries(MODE_AGENTS)) {
    const entry = config.agent?.[agentName];
    if (entry !== undefined) {
      agents[agentName] = routeFromValue(
        {
          ...entry,
          provider: undefined,
        },
        `opencode.json.agent.${agentName}`,
      );
      const modelRef = typeof entry?.model === "string"
        ? entry.model
        : typeof config.model === "string"
        ? config.model
        : undefined;
      if (typeof modelRef === "string" && modelRef.includes("/")) {
        const parsed = parseProviderModel(modelRef, `opencode.json.agent.${agentName}.model`, "effective");
        const providerConfig = config.provider?.[parsed.provider];
        const modelConfig = providerConfig?.models?.[parsed.model];
        const enriched = {
          provider: parsed.provider,
          model: parsed.model,
          serving_path: entry.serving_path ?? modelConfig?.serving_path ?? providerConfig?.serving_path,
          reasoning_effort:
            entry.reasoning_effort ??
            entry.reasoningEffort ??
            entry.variant ??
            entry.options?.reasoningEffort ??
            modelConfig?.reasoning_effort ??
            modelConfig?.reasoningEffort,
        };
        agents[agentName] = routeFromValue(enriched, `opencode.json.agent.${agentName}`);
      }
    } else if (modeName === "build" && typeof config.model === "string") {
      const parsed = parseProviderModel(config.model, "opencode.json.model", "effective");
      agents[agentName] = routeFromValue({ provider: parsed.provider, model: parsed.model }, "opencode.json.model");
    } else {
      agents[agentName] = { status: "missing" };
    }
  }
  return normalizeEffectiveConfig({
    agents,
    disabled_providers: Array.isArray(config.disabled_providers) ? config.disabled_providers : [],
  }, mode);
}

function normalizeCatalog(value) {
  if (!isPlainObject(value) || !isPlainObject(value.providers)) fail("live catalog is unverified", "catalog");
  const providers = {};
  for (const [provider, entry] of Object.entries(value.providers)) {
    if (!PROVIDER_PATTERN.test(provider) || !isPlainObject(entry)) fail("live catalog is unverified", "catalog");
    if (!new Set(["available", "unavailable", "unverified"]).has(entry.status)) {
      fail("live catalog status is unsupported", "catalog");
    }
    const providerResult = { status: entry.status };
    if (entry.reason_code !== undefined) {
      if (typeof entry.reason_code !== "string" || !/^[a-z][a-z0-9_]*$/u.test(entry.reason_code)) {
        fail("live catalog reason code is unverified", "catalog");
      }
      providerResult.reason_code = entry.reason_code;
    }
    if (entry.models !== undefined) {
      if (!isPlainObject(entry.models)) fail("live catalog models are unverified", "catalog");
      providerResult.models = {};
      for (const [model, modelEntry] of Object.entries(entry.models)) {
        if (!model || /[\u0000-\u001f\u007f\s]/u.test(model) || !isPlainObject(modelEntry)) {
          fail("live catalog model identity is unverified", "catalog");
        }
        assertAllowedKeys(
          modelEntry,
          ["serving_path", "reasoning_effort", "reasoning_efforts"],
          "live catalog model",
          "catalog",
        );
        if (modelEntry.serving_path !== undefined) {
          assertNonEmptyString(modelEntry.serving_path, "live catalog serving_path", {}, "catalog");
        }
        if (modelEntry.reasoning_effort !== undefined) {
          assertNonEmptyString(
            modelEntry.reasoning_effort,
            "live catalog reasoning_effort",
            { pattern: REASONING_EFFORT_PATTERN },
            "catalog",
          );
        }
        if (modelEntry.reasoning_efforts !== undefined) {
          assertUniqueStrings(modelEntry.reasoning_efforts, "live catalog reasoning_efforts", "catalog");
          for (const effort of modelEntry.reasoning_efforts) {
            if (!REASONING_EFFORT_PATTERN.test(effort)) fail("live catalog reasoning effort is unverified", "catalog");
          }
        }
        if (modelEntry.reasoning_effort !== undefined && modelEntry.reasoning_efforts !== undefined) {
          fail("live catalog must use one reasoning effort form", "catalog");
        }
        providerResult.models[model] = { ...modelEntry };
      }
    }
    providers[provider] = providerResult;
  }
  return { providers };
}

function staticCatalogForRoute(route) {
  return {
    providers: {
      [route.provider]: {
        status: "available",
        models: {
          [route.model]: {
            serving_path: route.serving_path,
            reasoning_effort: route.reasoning_effort,
          },
        },
      },
    },
  };
}

function catalogObservation(candidate, catalog) {
  let normalized;
  try {
    normalized = normalizeCatalog(catalog);
  } catch {
    return { status: "unverified", reason: "catalog_unverified" };
  }
  const provider = normalized.providers[candidate.provider];
  if (!provider) return { status: "unavailable", reason: "provider_missing" };
  if (provider.status !== "available") {
    if (provider.reason_code === "missing_credentials") {
      return { status: "unavailable", reason: "credentials_missing" };
    }
    return { status: "unavailable", reason: "provider_unavailable" };
  }
  const model = provider.models?.[candidate.model];
  if (!model) return { status: "unavailable", reason: "model_missing" };
  const servingPath = model.serving_path ?? candidate.provider;
  const efforts = model.reasoning_efforts ??
    (model.reasoning_effort === undefined ? undefined : [model.reasoning_effort]);
  if (servingPath !== candidate.serving_path) {
    return { status: "unavailable", reason: "route_identity_mismatch" };
  }
  if (candidate.reasoning_effort !== undefined && efforts !== undefined && !efforts.includes(candidate.reasoning_effort)) {
    return { status: "unavailable", reason: "route_identity_mismatch" };
  }
  return {
    status: "available",
    reasoning_effort: efforts === undefined ? "unavailable" : "available",
  };
}

function catalogErrorObservation(error) {
  if (error?.code === "missing_credentials") return { status: "unavailable", reason: "credentials_missing" };
  if (error?.code === "provider_unavailable") return { status: "unavailable", reason: "provider_unavailable" };
  return { status: "unverified", reason: "catalog_unverified" };
}

function restrictionObservation(candidate, manifestRouteID, restrictions) {
  if (restrictions === undefined) return { state: "unverified", reason: "restrictions_missing" };
  for (const provider of restrictions.prohibited_providers ?? []) {
    if (provider === candidate.provider) {
      return { state: "blocked", reason: "restriction_prohibited_provider" };
    }
  }
  if (
    restrictions.allowed_providers !== undefined &&
    !restrictions.allowed_providers.includes(candidate.provider)
  ) {
    return { state: "blocked", reason: "restriction_provider_not_allowed" };
  }
  for (const routeID of restrictions.prohibited_routes ?? []) {
    if (manifestRouteID === routeID) return { state: "blocked", reason: "restriction_prohibited_route" };
  }
  if (restrictions.allowed_routes !== undefined) {
    if (manifestRouteID === undefined) return { state: "unverified", reason: "restriction_route_identity_unverified" };
    if (!restrictions.allowed_routes.includes(manifestRouteID)) {
      return { state: "blocked", reason: "restriction_route_not_allowed" };
    }
  }
  const egress = restrictions.data_egress;
  if (egress?.disposition === "deny") {
    return { state: "blocked", reason: "restriction_data_egress_denied" };
  }
  if (
    egress?.disposition === "provider-pinned" &&
    (candidate.provider !== egress.provider || candidate.serving_path !== egress.serving_path)
  ) {
    return { state: "blocked", reason: "restriction_data_egress_provider_mismatch" };
  }
  return { state: "compatible" };
}

function effectiveObservation(candidate, effectiveConfig) {
  const routeState = effectiveConfig.route;
  const effectiveRoute = routeState.status === "resolved" ? routeState.route : undefined;
  if (effectiveConfig.disabled_providers.includes(candidate.provider)) {
    return {
      state: "unavailable",
      reason: "effective_provider_disabled",
      effectiveRoute,
    };
  }
  if (routeState.status === "missing") {
    return { state: "unavailable", reason: "effective_alias_missing", effectiveRoute };
  }
  if (routeState.status !== "resolved") {
    return { state: "unverified", reason: "effective_route_unverified", effectiveRoute };
  }
  if (routeState.route.provider !== candidate.provider || routeState.route.model !== candidate.model) {
    return { state: "unavailable", reason: "effective_alias_missing", effectiveRoute };
  }
  if (
    routeState.route.serving_path !== candidate.serving_path ||
    (routeState.route.reasoning_effort !== undefined &&
      candidate.reasoning_effort !== undefined &&
      routeState.route.reasoning_effort !== candidate.reasoning_effort)
  ) {
    return { state: "unverified", reason: "effective_route_unverified", effectiveRoute };
  }
  return { state: "compatible", effectiveRoute };
}

function nextAction(reason) {
  const actions = {
    advisor_disabled: "Enable the explicit /advise lane first.",
    restrictions_missing: "Declare normalized repository restrictions before relying on this observation.",
    restriction_prohibited_provider: "Choose an exact route allowed by the repository provider restriction.",
    restriction_provider_not_allowed: "Choose an exact route allowed by the repository provider allowlist.",
    restriction_prohibited_route: "Choose an exact route not prohibited by the repository restriction.",
    restriction_route_identity_unverified: "Declare an exact manifest route identity before using a route-ID restriction.",
    restriction_route_not_allowed: "Choose an exact route allowed by the repository route restriction.",
    restriction_data_egress_denied: "Use a repository-approved data-egress policy before selecting an external route.",
    restriction_data_egress_provider_mismatch: "Choose the exact provider and serving path permitted by the repository.",
    effective_provider_disabled: "Enable the provider or choose an exact developer route supported by the repository.",
    effective_alias_missing: "Configure the exact provider/model alias in the effective OpenCode configuration.",
    effective_route_unverified: "Declare the exact serving path and reasoning effort in the effective configuration.",
    catalog_unverified: "Verify the route with the installed provider catalog without changing the active route.",
    provider_missing: "Install or enable the provider, then choose an exact route.",
    provider_unavailable: "Make the provider available, then choose an exact route.",
    credentials_missing: "Authenticate the provider through its normal configuration path; do not provide credentials to the policy adapter.",
    model_missing: "Make the exact model available in the provider catalog or choose another exact route.",
    serving_path_unverified: "Verify the exact serving path in the installed provider catalog.",
    reasoning_effort_unverified: "Verify the exact reasoning effort in the installed provider catalog.",
    route_identity_mismatch: "Choose an exact route whose provider, model, serving path, and effort match the catalog.",
    no_managed_route: "Choose an allowed exact route; no managed policy route applies to this mode.",
    developer_route_unverified: "Declare an exact developer route that can be verified without inferring missing fields.",
  };
  return actions[reason] ?? "Choose an allowed exact route; the policy adapter will not substitute one.";
}

function fallbackFor(routeInfo) {
  return routeInfo?.fallback
    ? {
        disposition: FALLBACK_DISPOSITION,
        message: routeInfo.fallback.message,
      }
    : {
        disposition: FALLBACK_DISPOSITION,
        message: DEFAULT_FALLBACK_MESSAGE,
      };
}

function baseResolution({
  state,
  manifest,
  hash,
  precedenceSource,
  reason,
  catalog,
  routeInfo,
  effectiveRoute,
  policyRoute,
  developerSelection,
  controls,
  next = true,
}) {
  const result = {
    state,
    schema_version: 1,
    policy_version: manifest.policy_version,
    configuration_hash: hash,
    adapter_enabled: true,
    execution_altered: false,
    precedence_source: precedenceSource,
  };
  if (policyRoute) result.policy_route = { id: policyRoute.id, ...copyRoute(policyRoute.route) };
  if (developerSelection) result.developer_selection = { ...copyRoute(developerSelection.route) };
  if (developerSelection?.manifest_route_id) {
    result.developer_selection.manifest_route_id = developerSelection.manifest_route_id;
  }
  if (effectiveRoute) result.effective_execution_route = copyRoute(effectiveRoute);
  if (controls) result.controls = structuredClone(controls);
  result.route_metadata = {
    reasoning_effort: catalog.reasoning_effort ??
      (effectiveRoute?.reasoning_effort === undefined ? "unavailable" : "available"),
  };
  result.reason = reason;
  result.fallback = fallbackFor(routeInfo);
  result.catalog = { status: catalog.status };
  if (catalog.reason) result.catalog.reason = catalog.reason;
  if (next) result.next_action = nextAction(reason);
  return result;
}

function disabledResolution() {
  return {
    state: "disabled",
    adapter_enabled: false,
    execution_altered: false,
  };
}

export function resolvePolicy(input, options = {}) {
  const local = options.local ?? { policy_adapter_enabled: true, advisor_enabled: false };
  if (local.policy_adapter_enabled === false) return disabledResolution();
  if (local.policy_adapter_enabled !== true) fail("policy_adapter_enabled must be a boolean", "input");

  const manifest = parsePolicyManifest(options.manifest);
  const hash = policyConfigurationHash(manifest);
  const normalizedInput = normalizePolicyInput(input);
  let policyRoute = routeForMode(manifest, normalizedInput.mode);

  if (normalizedInput.mode === "advise" && local.advisor_enabled !== true) {
    return baseResolution({
      state: "unavailable",
      manifest,
      hash,
      precedenceSource: "mode",
      reason: "advisor_disabled",
      catalog: { status: "unverified", reason: "advisor_disabled" },
      routeInfo: policyRoute,
    });
  }

  const effectiveConfig = options.effectiveConfig !== undefined
    ? normalizeEffectiveConfig(options.effectiveConfig, normalizedInput.mode)
    : { status: "missing", agents: {}, disabled_providers: [], route: { status: "missing" } };
  if (normalizedInput.mode === "ultra" && policyRoute) {
    if (effectiveConfig.route.status === "resolved") {
      policyRoute = {
        ...policyRoute,
        route: copyRoute(effectiveConfig.route.route),
      };
    } else {
      policyRoute = undefined;
    }
  }

  const developerRoute = normalizedInput.developer_selection
    ? {
        route: normalizedInput.developer_selection,
        manifest_route_id: policyRoute && sameRoute(policyRoute.route, normalizedInput.developer_selection)
          ? policyRoute.id
          : manifestRouteForIdentity(
            manifest,
            normalizedInput.mode,
            normalizedInput.developer_selection,
          ),
      }
    : undefined;
  const candidate = developerRoute?.route ?? policyRoute?.route;
  const routeInfo = developerRoute ? undefined : policyRoute;

  if (!candidate) {
    const unavailableReason = normalizedInput.mode === "ultra" &&
      routeForMode(manifest, normalizedInput.mode)
      ? effectiveConfig.route.status === "unverified"
        ? "effective_route_unverified"
        : "effective_alias_missing"
      : undefined;
    if (unavailableReason) {
      return baseResolution({
        state: unavailableReason === "effective_alias_missing" ? "unavailable" : "unverified",
        manifest,
        hash,
        precedenceSource: "managed",
        reason: unavailableReason,
        catalog: {
          status: unavailableReason === "effective_alias_missing" ? "unavailable" : "unverified",
          reason: unavailableReason,
        },
        effectiveRoute: effectiveConfig.route.status === "resolved"
          ? effectiveConfig.route.route
          : undefined,
        routeInfo: undefined,
      });
    }
    return baseResolution({
      state: "no_managed_route",
      manifest,
      hash,
      precedenceSource: "ordinary_default",
      reason: "no_managed_route",
      catalog: { status: "unverified", reason: "no_managed_route" },
      effectiveRoute: undefined,
      routeInfo: undefined,
    });
  }

  if (normalizedInput.restriction_error) {
    const result = baseResolution({
      state: "unverified",
      manifest,
      hash,
      precedenceSource: "repository",
      reason: "restrictions_missing",
      catalog: { status: "unverified", reason: "restrictions_missing" },
      routeInfo,
      effectiveRoute: effectiveConfig.route.status === "resolved"
        ? effectiveConfig.route.route
        : undefined,
      developerSelection: developerRoute,
    });
    delete result.policy_route;
    return result;
  }

  const restriction = restrictionObservation(
    candidate,
    developerRoute?.manifest_route_id ?? policyRoute?.id,
    normalizedInput.repository_restrictions,
  );
  if (restriction.state !== "compatible") {
    const result = baseResolution({
      state: restriction.state,
      manifest,
      hash,
      precedenceSource: "repository",
      reason: restriction.reason,
      catalog: { status: "unverified", reason: restriction.reason },
      routeInfo,
      effectiveRoute: effectiveConfig.route.status === "resolved"
        ? effectiveConfig.route.route
        : undefined,
      developerSelection: developerRoute,
    });
    if (developerRoute) delete result.policy_route;
    return result;
  }

  const suppliedCatalog = options.liveCatalog !== undefined
    ? options.liveCatalog
    : normalizedInput.live_catalog;
  const effective = effectiveObservation(candidate, effectiveConfig);
  if (effective.state !== "compatible") {
    const result = baseResolution({
      state: effective.state,
      manifest,
      hash,
      precedenceSource: developerRoute ? "developer" : "managed",
      reason: developerRoute ? "developer_route_unverified" : effective.reason,
      catalog: { status: effective.state === "unavailable" ? "unavailable" : "unverified", reason: effective.reason },
      routeInfo,
      effectiveRoute: effective.effectiveRoute,
      developerSelection: developerRoute,
      controls: developerRoute ? undefined : policyRoute?.controls,
    });
    if (developerRoute) delete result.policy_route;
    return result;
  }

  let catalog;
  try {
    if (suppliedCatalog !== undefined) {
      catalog = catalogObservation(candidate, suppliedCatalog);
    } else if (typeof options.loadCatalog === "function") {
      catalog = catalogObservation(candidate, options.loadCatalog(candidate.provider));
    } else {
      catalog = { status: "unverified", reason: "catalog_unverified" };
    }
  } catch (error) {
    catalog = catalogErrorObservation(error);
  }
  if (catalog.status !== "available") {
    const result = baseResolution({
      state: catalog.status === "unavailable" ? "unavailable" : "unverified",
      manifest,
      hash,
      precedenceSource: developerRoute ? "developer" : "managed",
      reason: catalog.reason,
      catalog,
      routeInfo,
      effectiveRoute: effective.effectiveRoute,
      developerSelection: developerRoute,
      controls: developerRoute ? undefined : policyRoute?.controls,
    });
    if (developerRoute) delete result.policy_route;
    return result;
  }

  return baseResolution({
    state: "resolved",
    manifest,
    hash,
    precedenceSource: developerRoute ? "developer" : "managed",
    reason: developerRoute ? "developer_route_available" : "managed_route_available",
    catalog,
    routeInfo,
    policyRoute,
    effectiveRoute: effective.effectiveRoute,
    developerSelection: developerRoute,
    controls: developerRoute ? undefined : policyRoute?.controls,
  });
}

export function resolvePolicyFromSources({
  local,
  loadManifest,
  input,
  effectiveConfig,
  liveCatalog,
  loadCatalog,
}) {
  if (local?.policy_adapter_enabled === false) return disabledResolution();
  if (typeof loadManifest !== "function") fail("manifest loader is required", "input");
  return resolvePolicy(input, {
    local,
    manifest: loadManifest(),
    effectiveConfig,
    liveCatalog,
    loadCatalog,
  });
}

export function localRoutingPath(configDir) {
  return path.join(configDir, "model-routing.config.local.json");
}

export function readPolicyLocalState(configDir) {
  const filePath = localRoutingPath(configDir);
  if (!fs.existsSync(filePath)) {
    return { policy_adapter_enabled: true, advisor_enabled: false, agent_overrides: {} };
  }
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    fail("local routing configuration is not valid JSON", "input");
  }
  if (!isPlainObject(value)) fail("local routing configuration must be an object", "input");
  const policyAdapterEnabled = value.policy_adapter_enabled ?? true;
  const advisorEnabled = value.advisor_enabled ?? false;
  if (typeof policyAdapterEnabled !== "boolean") fail("policy_adapter_enabled must be a boolean", "input");
  if (typeof advisorEnabled !== "boolean") fail("advisor_enabled must be a boolean", "input");
  return {
    policy_adapter_enabled: policyAdapterEnabled,
    advisor_enabled: advisorEnabled,
    agent_overrides: isPlainObject(value.agents) ? { ...value.agents } : {},
  };
}

function localDeveloperSelection(local, mode, effectiveConfig) {
  if (mode !== "build" && mode !== "ultra") return undefined;
  const effectiveRoute = normalizeEffectiveConfig(effectiveConfig, mode).route;
  const overrideName = mode === "ultra" && typeof local.agent_overrides.ultra === "string"
    ? "ultra"
    : "build";
  const override = local.agent_overrides[overrideName];
  if (typeof override !== "string" || effectiveRoute.status !== "resolved") return undefined;
  const expected = parseProviderModel(override, `local ${overrideName} override`, "input");
  if (effectiveRoute.route.provider !== expected.provider || effectiveRoute.route.model !== expected.model) {
    return undefined;
  }
  return copyRoute(effectiveRoute.route);
}

function readJsonFile(filePath, label) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    fail(`${label} is not valid JSON`, "input");
  }
}

export function inspectPolicyInstallation({ repoRoot, configDir }) {
  const local = readPolicyLocalState(configDir);
  if (local.policy_adapter_enabled === false) return disabledResolution();
  const manifest = parsePolicyManifest(
    readJsonFile(path.join(repoRoot, "opencode", "control-plane-policy.json"), "policy manifest"),
  );
  return {
    state: "validated",
    schema_version: manifest.schema_version,
    policy_version: manifest.policy_version,
    configuration_hash: policyConfigurationHash(manifest),
    adapter_enabled: true,
    execution_altered: false,
  };
}

export function policyObservationDirectory(environment = process.env) {
  const explicit = environment.OPENCODE_POLICY_OBSERVATION_DIR?.trim();
  if (explicit) return path.resolve(explicit);
  const stateHome = environment.XDG_STATE_HOME?.trim() || path.join(os.homedir(), ".local", "state");
  return path.join(stateHome, "opencode", "policy-observations");
}

function observationRecord(resolution, observedAt) {
  const payload = {
    observation_schema_version: OBSERVATION_SCHEMA_VERSION,
    observed_at: observedAt.toISOString(),
    resolution: redactPolicyResolution(resolution),
  };
  validatePersistedResolution(payload.resolution);
  return {
    ...payload,
    observation_sha256: observationIntegrity(payload),
  };
}

function redactText(value) {
  if (typeof value !== "string") return value;
  return /bearer|api[_-]?key|secret|token|account[_-]?id|https?:\/\//iu.test(value)
    ? "[redacted]"
    : value;
}

function redactRoute(route) {
  if (!route) return route;
  const redacted = copyRoute(route);
  const identity = [redacted.provider, redacted.model, redacted.serving_path].join("\u0000");
  if (!OBSERVABLE_ROUTE_IDENTITIES.has(identity)) {
    redacted.provider = "redacted";
    redacted.model = "redacted";
    redacted.serving_path = "redacted";
  }
  if (redacted.reasoning_effort && /bearer|api[_-]?key|secret|token|https?:\/\//iu.test(redacted.reasoning_effort)) {
    delete redacted.reasoning_effort;
  }
  return redacted;
}

export function redactPolicyResolution(resolution) {
  const redacted = structuredClone(resolution);
  for (const field of ["policy_route", "developer_selection", "effective_execution_route"]) {
    if (redacted[field]) {
      const sensitiveEffort = /bearer|api[_-]?key|secret|token|https?:\/\//iu.test(
        redacted[field].reasoning_effort ?? "",
      );
      const route = redactRoute(redacted[field]);
      if (field === "policy_route") redacted[field] = { id: redacted[field].id, ...route };
      else if (field === "developer_selection") {
        redacted[field] = {
          ...route,
          ...(redacted[field].manifest_route_id
            ? { manifest_route_id: redacted[field].manifest_route_id }
            : {}),
        };
      } else redacted[field] = route;
      if (sensitiveEffort && redacted.route_metadata) {
        redacted.route_metadata.reasoning_effort = "unavailable";
      }
    }
  }
  if (redacted.reason) redacted.reason = redactText(redacted.reason);
  if (redacted.catalog?.reason) redacted.catalog.reason = redactText(redacted.catalog.reason);
  if (redacted.fallback?.message) redacted.fallback.message = redactText(redacted.fallback.message);
  if (redacted.next_action) redacted.next_action = redactText(redacted.next_action);
  return redacted;
}

function receiptDecision(resolution) {
  if (resolution.adapter_enabled === false) return "adapter_disabled";
  if (resolution.state === "blocked") return "block";
  if (resolution.state === "unavailable" || resolution.state === "unverified" || resolution.state === "no_managed_route") {
    return resolution.state;
  }
  if (resolution.precedence_source === "developer") return "overridden";
  return "allow";
}

function receiptPayload(receipt) {
  const { receipt_id, ...payload } = receipt;
  return payload;
}

function receiptIdentifier(receipt) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(receiptPayload(receipt)), "utf8").digest("hex")}`;
}

export function parsePolicyDecisionReceipt(value) {
  assertExactKeys(
    value,
    [
      "receipt_schema_version",
      "receipt_id",
      "observed_at",
      "policy_version",
      "route_id",
      "rule_id",
      "decision",
      "reason_code",
      "declared_inputs",
      "configuration_hash",
    ],
    "policy decision receipt",
    "receipt",
  );
  if (value.receipt_schema_version !== DECISION_RECEIPT_SCHEMA_VERSION) fail("policy decision receipt schema version is unsupported", "receipt");
  assertNonEmptyString(value.receipt_id, "policy decision receipt receipt_id", { pattern: /^sha256:[a-f0-9]{64}$/u }, "receipt");
  assertNonEmptyString(value.observed_at, "policy decision receipt observed_at", {}, "receipt");
  if (!Number.isFinite(Date.parse(value.observed_at))) fail("policy decision receipt observed_at is invalid", "receipt");
  if (value.policy_version !== null) assertPositiveInteger(value.policy_version, "policy decision receipt policy_version", "receipt");
  if (value.route_id !== null) assertNonEmptyString(value.route_id, "policy decision receipt route_id", { pattern: ROUTE_ID_PATTERN }, "receipt");
  assertNonEmptyString(value.rule_id, "policy decision receipt rule_id", { pattern: ROUTE_ID_PATTERN }, "receipt");
  if (typeof value.decision !== "string" || !RECEIPT_DECISIONS.has(value.decision)) fail("policy decision receipt decision is unsupported", "receipt");
  assertNonEmptyString(value.reason_code, "policy decision receipt reason_code", {}, "receipt");
  assertExactKeys(value.declared_inputs, ["developer_selection"], "policy decision receipt declared_inputs", "receipt");
  if (typeof value.declared_inputs.developer_selection !== "boolean") fail("policy decision receipt developer_selection must be a boolean", "receipt");
  if (value.configuration_hash !== null) assertNonEmptyString(value.configuration_hash, "policy decision receipt configuration_hash", { pattern: /^sha256:[a-f0-9]{64}$/u }, "receipt");
  if (value.receipt_id !== receiptIdentifier(value)) fail("policy decision receipt integrity check failed", "receipt");
  return structuredClone(value);
}

export function createPolicyDecisionReceipt(resolution, { observedAt = new Date() } = {}) {
  const redacted = redactPolicyResolution(resolution);
  const decision = receiptDecision(redacted);
  const receipt = {
    receipt_schema_version: DECISION_RECEIPT_SCHEMA_VERSION,
    receipt_id: "",
    observed_at: observedAt.toISOString(),
    policy_version: redacted.policy_version ?? null,
    route_id: redacted.policy_route?.id ?? redacted.developer_selection?.manifest_route_id ?? null,
    rule_id: decision === "adapter_disabled" ? "adapter-disabled" : (redacted.reason ?? "managed-route-available").replace(/_/gu, "-"),
    decision,
    reason_code: redacted.reason ?? "adapter_disabled",
    declared_inputs: { developer_selection: Boolean(redacted.developer_selection) },
    configuration_hash: redacted.configuration_hash ?? null,
  };
  receipt.receipt_id = receiptIdentifier(receipt);
  return parsePolicyDecisionReceipt(receipt);
}

function validatePersistedRoute(route, label, { id = false, developer = false } = {}) {
  const keys = ["provider", "model", "serving_path", "reasoning_effort"];
  if (id) keys.unshift("id");
  if (developer) keys.push("manifest_route_id");
  assertAllowedKeys(route, keys, label, "observation");
  assertExactRoute(
    Object.fromEntries(
      ["provider", "model", "serving_path", "reasoning_effort"]
        .filter((field) => Object.hasOwn(route, field))
        .map((field) => [field, route[field]]),
    ),
    label,
    "observation",
  );
  if (id) assertNonEmptyString(route.id, `${label}.id`, { pattern: ROUTE_ID_PATTERN }, "observation");
  if (developer && route.manifest_route_id !== undefined) {
    assertNonEmptyString(
      route.manifest_route_id,
      `${label}.manifest_route_id`,
      { pattern: ROUTE_ID_PATTERN },
      "observation",
    );
  }
}

function validatePersistedResolution(resolution) {
  assertAllowedKeys(
    resolution,
    [
      "state",
      "schema_version",
      "policy_version",
      "configuration_hash",
      "adapter_enabled",
      "execution_altered",
      "precedence_source",
      "policy_route",
      "developer_selection",
      "effective_execution_route",
      "route_metadata",
      "reason",
      "controls",
      "fallback",
      "catalog",
      "next_action",
    ],
    "policy observation resolution",
    "observation",
  );
  if (!new Set(["resolved", "blocked", "unavailable", "unverified", "no_managed_route"]).has(resolution.state)) {
    fail("policy observation state is unsupported", "observation");
  }
  if (resolution.schema_version !== 1) fail("policy observation schema version is unsupported", "observation");
  assertPositiveInteger(resolution.policy_version, "policy observation policy_version", "observation");
  assertNonEmptyString(
    resolution.configuration_hash,
    "policy observation configuration_hash",
    { pattern: /^sha256:[a-f0-9]{64}$/u },
    "observation",
  );
  if (resolution.adapter_enabled !== true || resolution.execution_altered !== false) {
    fail("policy observation must remain enabled and observe-only", "observation");
  }
  if (!new Set(["repository", "developer", "mode", "managed", "ordinary_default"]).has(resolution.precedence_source)) {
    fail("policy observation precedence source is unsupported", "observation");
  }
  if (resolution.policy_route !== undefined) {
    validatePersistedRoute(resolution.policy_route, "policy observation policy_route", { id: true });
  }
  if (resolution.developer_selection !== undefined) {
    validatePersistedRoute(
      resolution.developer_selection,
      "policy observation developer_selection",
      { developer: true },
    );
  }
  if (resolution.effective_execution_route !== undefined) {
    validatePersistedRoute(
      resolution.effective_execution_route,
      "policy observation effective_execution_route",
    );
  }
  if (resolution.route_metadata !== undefined) {
    assertExactKeys(resolution.route_metadata, ["reasoning_effort"], "policy observation route_metadata", "observation");
    if (!new Set(["available", "unavailable"]).has(resolution.route_metadata.reasoning_effort)) {
      fail("policy observation effort metadata is unsupported", "observation");
    }
  }
  if (resolution.controls !== undefined) validateControls(resolution.controls, "policy observation controls");
  assertNonEmptyString(resolution.reason, "policy observation reason", {}, "observation");
  if (!POLICY_REASON_CODES.has(resolution.reason)) {
    fail("policy observation reason is unsupported", "observation");
  }
  assertExactKeys(resolution.fallback, ["disposition", "message"], "policy observation fallback", "observation");
  if (resolution.fallback.disposition !== FALLBACK_DISPOSITION) {
    fail("policy observation fallback is unsupported", "observation");
  }
  assertNonEmptyString(resolution.fallback.message, "policy observation fallback.message", {}, "observation");
  assertAllowedKeys(resolution.catalog, ["status", "reason"], "policy observation catalog", "observation");
  if (!Object.hasOwn(resolution.catalog, "status")) {
    fail("policy observation catalog status is missing", "observation");
  }
  if (!new Set(["available", "unavailable", "unverified"]).has(resolution.catalog.status)) {
    fail("policy observation catalog status is unsupported", "observation");
  }
  if (resolution.catalog.reason !== undefined) {
    assertNonEmptyString(resolution.catalog.reason, "policy observation catalog.reason", {}, "observation");
    if (!POLICY_REASON_CODES.has(resolution.catalog.reason)) {
      fail("policy observation catalog.reason is unsupported", "observation");
    }
  }
  if (resolution.next_action !== undefined) {
    assertNonEmptyString(resolution.next_action, "policy observation next_action", {}, "observation");
  }
}

function observationIntegrity(payload) {
  return `sha256:${crypto.createHash("sha256").update(canonicalJson(payload), "utf8").digest("hex")}`;
}

function writePrivateJson(filePath, value) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${Date.now()}`,
  );
  const content = `${JSON.stringify(value)}\n`;
  let handle;
  try {
    handle = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(handle, content, "utf8");
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    fs.chmodSync(temporaryPath, 0o600);
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (handle !== undefined) fs.closeSync(handle);
    fs.rmSync(temporaryPath, { force: true });
  }
}

export function recordPolicyObservation({
  resolution,
  directory = policyObservationDirectory(),
  observedAt = new Date(),
}) {
  if (resolution?.adapter_enabled !== true || resolution.execution_altered !== false) {
    fail("only enabled observe-only resolutions may be persisted", "observation");
  }
  const record = observationRecord(resolution, observedAt);
  writePrivateJson(path.join(directory, "latest.json"), record);
  return record;
}

export function readPolicyObservation(directory = policyObservationDirectory()) {
  const filePath = path.join(directory, "latest.json");
  if (!fs.existsSync(filePath)) fail("no policy observation has been recorded", "observation");
  const record = readJsonFile(filePath, "policy observation");
  if (!isPlainObject(record)) {
    fail("policy observation has an unsupported schema", "observation");
  }
  assertExactKeys(
    record,
    ["observation_schema_version", "observed_at", "resolution", "observation_sha256"],
    "policy observation",
    "observation",
  );
  if (
    record.observation_schema_version !== OBSERVATION_SCHEMA_VERSION ||
    typeof record.observed_at !== "string" ||
    Number.isNaN(Date.parse(record.observed_at)) ||
    !isPlainObject(record.resolution)
  ) {
    fail("policy observation has an unsupported schema", "observation");
  }
  assertNonEmptyString(
    record.observation_sha256,
    "policy observation observation_sha256",
    { pattern: /^sha256:[a-f0-9]{64}$/u },
    "observation",
  );
  validatePersistedResolution(record.resolution);
  const redacted = redactPolicyResolution(record.resolution);
  if (JSON.stringify(redacted) !== JSON.stringify(record.resolution)) {
    fail("policy observation contains unredacted fields", "observation");
  }
  const payload = {
    observation_schema_version: record.observation_schema_version,
    observed_at: record.observed_at,
    resolution: record.resolution,
  };
  if (observationIntegrity(payload) !== record.observation_sha256) {
    fail("policy observation integrity check failed", "observation");
  }
  return record;
}

function jsonObjectEnd(source, start) {
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') quoted = false;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  return undefined;
}

function catalogFromCommand(provider, configDir) {
  const result = Bun.spawnSync(
    ["opencode", "models", provider, "--verbose", "--pure"],
    {
      cwd: os.tmpdir(),
      env: { ...process.env, OPENCODE_CONFIG_DIR: configDir },
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  if (result.exitCode !== 0) {
    const error = new Error("provider catalog is unavailable");
    error.code = /credential|api[ _-]?key|unauthori[sz]ed|forbidden/iu.test(result.stderr.toString())
      ? "missing_credentials"
      : "provider_unavailable";
    throw error;
  }
  const source = result.stdout.toString();
  const models = {};
  let cursor = 0;
  try {
    while (cursor < source.length) {
      while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
      if (cursor >= source.length) break;
      const lineEnd = source.indexOf("\n", cursor);
      if (lineEnd === -1) throw new Error("catalog line missing");
      const fullModel = source.slice(cursor, lineEnd).trim();
      if (!fullModel.startsWith(`${provider}/`)) {
        throw new Error("catalog model identity is invalid");
      }
      const start = source.indexOf("{", lineEnd + 1);
      const end = start === -1 ? undefined : jsonObjectEnd(source, start);
      if (end === undefined) throw new Error("catalog metadata is incomplete");
      const metadata = JSON.parse(source.slice(start, end));
      const model = fullModel.slice(provider.length + 1);
      models[model] = {
        ...(typeof metadata.serving_path === "string" ? { serving_path: metadata.serving_path } : {}),
        ...(typeof metadata.reasoning_effort === "string"
          ? { reasoning_effort: metadata.reasoning_effort }
          : Array.isArray(metadata.reasoning_efforts)
          ? { reasoning_efforts: metadata.reasoning_efforts }
          : {}),
      };
      cursor = end;
    }
  } catch {
    const error = new Error("provider catalog is unverified");
    error.code = "catalog_unverified";
    throw error;
  }
  return { providers: { [provider]: { status: "available", models } } };
}

function parseArguments(argv) {
  const options = {
    repoRoot: path.resolve(path.dirname(new URL(import.meta.url).pathname), ".."),
    configDir: process.env.OPENCODE_CONFIG_DIR || path.join(os.homedir(), ".config", "opencode"),
    input: undefined,
    validate: false,
    query: false,
    observe: true,
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--validate") options.validate = true;
    else if (argument === "--query") options.query = true;
    else if (argument === "--no-observe") options.observe = false;
    else if (argument === "--observe") options.observe = true;
    else if (argument === "--input") {
      options.input = argv[++index];
      if (!options.input) fail("--input requires a path", "input");
    } else if (argument.startsWith("--")) {
      fail(`unsupported argument ${argument}`, "input");
    } else positional.push(argument);
  }
  if (positional[0]) options.repoRoot = path.resolve(positional[0]);
  if (positional[1]) options.configDir = path.resolve(positional[1]);
  if (positional.length > 2) fail("too many positional arguments", "input");
  return options;
}

function readInput(inputPath) {
  if (inputPath === "-") {
    return JSON.parse(fs.readFileSync(0, "utf8"));
  }
  return readJsonFile(path.resolve(inputPath), "policy input");
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function main(argv) {
  const options = parseArguments(argv);
  const local = readPolicyLocalState(options.configDir);
  if (local.policy_adapter_enabled === false) {
    printJson(disabledResolution());
    return;
  }
  if (options.query) {
    printJson(readPolicyObservation(policyObservationDirectory(process.env)));
    return;
  }
  const manifestPath = path.join(options.repoRoot, "opencode", "control-plane-policy.json");
  if (options.validate) {
    printJson(inspectPolicyInstallation({ repoRoot: options.repoRoot, configDir: options.configDir }));
    return;
  }
  if (!options.input) fail("--input is required for policy resolution", "input");
  const envelope = readInput(options.input);
  const policyInput = isPlainObject(envelope) && isPlainObject(envelope.input)
    ? envelope.input
    : (() => {
        if (!isPlainObject(envelope)) return envelope;
        const { effective_config: _effectiveConfig, ...input } = envelope;
        return input;
      })();
  const effectiveConfig = isPlainObject(envelope) ? envelope.effective_config : undefined;
  const liveCatalog = isPlainObject(envelope) ? envelope.live_catalog : undefined;
  const resolvedEffectiveConfig = effectiveConfig ?? effectiveRouteFromConfigFile(options.configDir, policyInput.mode);
  const selection = isPlainObject(policyInput) && policyInput.developer_selection === undefined
    ? localDeveloperSelection(local, policyInput.mode, resolvedEffectiveConfig)
    : undefined;
  const resolution = resolvePolicy(selection ? { ...policyInput, developer_selection: selection } : policyInput, {
    local,
    manifest: readJsonFile(manifestPath, "policy manifest"),
    effectiveConfig: resolvedEffectiveConfig,
    liveCatalog,
    loadCatalog: (provider) => catalogFromCommand(provider, options.configDir),
  });
  if (!options.observe) {
    printJson(redactPolicyResolution(resolution));
    return;
  }
  printJson(recordPolicyObservation({ resolution }));
}

if (import.meta.main) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(`ERROR  ${error instanceof Error ? error.message : "policy resolution failed"}`);
    process.exitCode = 1;
  }
}
