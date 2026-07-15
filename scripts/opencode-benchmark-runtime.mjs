import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

const OPENAI_MODELS = {
  "gpt-5.5": {
    cost: {
      input: 5,
      output: 30,
      cache_read: 0.5,
    },
    limit: {
      context: 1050000,
      input: 922000,
      output: 128000,
    },
  },
  "gpt-5.6-luna": {
    cost: {
      input: 1,
      output: 6,
      cache_read: 0.1,
      cache_write: 1.25,
    },
    limit: {
      context: 1050000,
      input: 922000,
      output: 128000,
    },
  },
  "gpt-5.6-sol": {
    cost: {
      input: 5,
      output: 30,
      cache_read: 0.5,
      cache_write: 6.25,
    },
    limit: {
      context: 1050000,
      input: 922000,
      output: 128000,
    },
  },
  "gpt-5.6-terra": {
    cost: {
      input: 2.5,
      output: 15,
      cache_read: 0.25,
      cache_write: 3.125,
    },
    limit: {
      context: 1050000,
      input: 922000,
      output: 128000,
    },
  },
};

const TRUSTED_PROVIDER_CONFIG = {
  openai: {
    npm: "@ai-sdk/openai",
    options: {
      headerTimeout: false,
      timeout: 600000,
      chunkTimeout: 120000,
    },
    models: OPENAI_MODELS,
  },
  anthropic: {
    npm: "@ai-sdk/anthropic",
  },
  baseten: {
    npm: "@ai-sdk/openai-compatible",
    options: {
      baseURL: "https://inference.baseten.co/v1",
    },
    models: {
      "zai-org/GLM-5.2": {
        limit: {
          context: 202720,
          input: 202720,
          output: 128000,
        },
      },
    },
    whitelist: [
      "deepseek-ai/DeepSeek-V4-Pro",
      "zai-org/GLM-5.2",
      "moonshotai/Kimi-K2.7-Code",
    ],
  },
  "fireworks-ai": {
    npm: "@ai-sdk/openai-compatible",
    options: {
      baseURL: "https://api.fireworks.ai/inference/v1/",
    },
    whitelist: [
      "accounts/fireworks/models/glm-5p2",
      "accounts/fireworks/routers/glm-5p2-fast",
      "accounts/fireworks/models/kimi-k2p7-code",
      "accounts/fireworks/routers/kimi-k2p7-code-fast",
    ],
  },
};

const EXPECTED_COMPATIBLE_APIS = {
  baseten: {
    npm: "@ai-sdk/openai-compatible",
    url: "https://inference.baseten.co/v1",
  },
  "fireworks-ai": {
    npm: "@ai-sdk/openai-compatible",
    url: "https://api.fireworks.ai/inference/v1/",
  },
};

const MODEL_PRICING = {
  "openai/gpt-5.5": {
    input: 5,
    output: 30,
    cache_read: 0.5,
    long_context_threshold: 272000,
  },
  "openai/gpt-5.6-luna": {
    input: 1,
    output: 6,
    cache_read: 0.1,
    cache_write: 1.25,
    long_context_threshold: 272000,
  },
  "openai/gpt-5.6-sol": {
    input: 5,
    output: 30,
    cache_read: 0.5,
    cache_write: 6.25,
    long_context_threshold: 272000,
  },
  "openai/gpt-5.6-terra": {
    input: 2.5,
    output: 15,
    cache_read: 0.25,
    cache_write: 3.125,
    long_context_threshold: 272000,
  },
  "baseten/zai-org/GLM-5.2": {
    input: 1.4,
    output: 4.4,
    cache_read: 0.26,
  },
  "fireworks-ai/accounts/fireworks/models/glm-5p2": {
    input: 1.4,
    output: 4.4,
    cache_read: 0.14,
  },
  "fireworks-ai/accounts/fireworks/routers/glm-5p2-fast": {
    input: 2.1,
    output: 6.6,
    cache_read: 0.21,
  },
  "baseten/moonshotai/Kimi-K2.7-Code": {
    input: 0.95,
    output: 4,
    cache_read: 0.16,
  },
  "baseten/deepseek-ai/DeepSeek-V4-Pro": {
    input: 1.74,
    output: 3.48,
    cache_read: 0.145,
  },
  "fireworks-ai/accounts/fireworks/models/kimi-k2p7-code": {
    input: 0.95,
    output: 4,
    cache_read: 0.19,
  },
  "fireworks-ai/accounts/fireworks/routers/kimi-k2p7-code-fast": {
    input: 1.9,
    output: 8,
    cache_read: 0.38,
  },
};

function clonedTrustedProviders() {
  return structuredClone(TRUSTED_PROVIDER_CONFIG);
}

export function benchmarkInstructionManifest(cwd) {
  const instructionPath = path.join(path.resolve(cwd), "AGENTS.md");
  const entry = fs.lstatSync(instructionPath, { throwIfNoEntry: false });
  if (!entry) return [];
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`Benchmark instruction path must be a regular file: ${instructionPath}`);
  }
  return [{
    path: instructionPath,
    sha256: createHash("sha256")
      .update(fs.readFileSync(instructionPath))
      .digest("hex"),
  }];
}

export function benchmarkConfigWithProviders(cwd, benchmarkConfig) {
  const config = structuredClone(benchmarkConfig);
  // Provider definitions are part of the benchmark protocol. Never merge a
  // project, global, or caller-supplied provider because it could redirect a
  // supposedly matched route to different code or an arbitrary endpoint.
  config.provider = clonedTrustedProviders();
  // Project config loading is disabled at runtime. Preserve the root workload
  // contract explicitly without trusting project opencode.json content.
  config.instructions = benchmarkInstructionManifest(cwd)
    .map((instruction) => instruction.path);
  return JSON.stringify(config);
}

function validatedJsonObject(source, label) {
  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${label} must contain valid JSON`, { cause: error });
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return source;
}

export function loadOpenCodeAuthContent({
  env = process.env,
  dataHome = env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share"),
} = {}) {
  if (Object.hasOwn(env, "OPENCODE_AUTH_CONTENT")) {
    return validatedJsonObject(
      env.OPENCODE_AUTH_CONTENT,
      "OPENCODE_AUTH_CONTENT",
    );
  }
  const authPath = path.join(dataHome, "opencode", "auth.json");
  const entry = fs.lstatSync(authPath, { throwIfNoEntry: false });
  if (!entry) return "{}";
  if (!entry.isFile() || entry.isSymbolicLink()) {
    throw new Error(`OpenCode auth path must be a regular file: ${authPath}`);
  }
  return validatedJsonObject(fs.readFileSync(authPath, "utf8"), authPath);
}

export function assertParallelModelAuthSafe({
  authContent,
  concurrency,
  models,
}) {
  if (concurrency <= 1) return;

  const auth = JSON.parse(validatedJsonObject(
    authContent,
    "OpenCode auth content",
  ));
  const selectedProviders = new Set(models.map((model) => {
    const separator = model.indexOf("/");
    if (separator <= 0) {
      throw new Error(`Invalid OpenCode model identifier: ${model}`);
    }
    return model.slice(0, separator);
  }));
  const oauthProviders = [...selectedProviders]
    .filter((provider) => auth[provider]?.type === "oauth")
    .sort();
  if (oauthProviders.length === 0) return;

  throw new Error(
    `Parallel benchmark routes cannot use OAuth-backed providers (${oauthProviders.join(", ")}): cloned auth homes cannot safely coordinate refresh-token rotation. Run these routes with --concurrency 1 or use non-OAuth provider credentials.`,
  );
}

export function isolatedOpenCodeEnvironment({
  baseEnv = process.env,
  configContent,
  configHome,
  dataHome,
  authContent,
  cwd,
}) {
  const env = { ...baseEnv };
  for (const name of [
    "ANTHROPIC_BASE_URL",
    "OPENAI_BASE_URL",
    "OPENAI_CUSTOM_HEADERS",
    "OPENCODE_CONFIG",
    "OPENCODE_CONFIG_CONTENT",
    "OPENCODE_CONFIG_DIR",
    "OPENCODE_MODELS_PATH",
    "OPENCODE_MODELS_URL",
    "OPENCODE_TEST_HOME",
    "OPENCODE_TEST_MANAGED_CONFIG_DIR",
  ]) {
    delete env[name];
  }
  return {
    ...env,
    PWD: cwd,
    INIT_CWD: cwd,
    XDG_CONFIG_HOME: configHome,
    XDG_DATA_HOME: dataHome,
    OPENCODE_AUTH_CONTENT: authContent,
    OPENCODE_CONFIG_CONTENT: configContent,
    OPENCODE_CONFIG_DIR: path.join(configHome, "opencode"),
    OPENCODE_DISABLE_PROJECT_CONFIG: "true",
  };
}

function milliseconds(value) {
  return Number.isFinite(value) ? Number(value) : undefined;
}

function secondsBetween(start, end) {
  if (start === undefined || end === undefined) return null;
  return Math.max(0, end - start) / 1000;
}

function percentile(values, fraction) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)];
}

function distribution(values) {
  const present = values.filter((value) => Number.isFinite(value));
  return {
    count: present.length,
    total: present.length > 0
      ? present.reduce((total, value) => total + value, 0)
      : null,
    p50: percentile(present, 0.5),
    p90: percentile(present, 0.9),
    max: present.length > 0 ? Math.max(...present) : null,
  };
}

function actionStart(event) {
  if (event.type === "text" || event.type === "reasoning") {
    return milliseconds(event.part?.time?.start) ?? milliseconds(event.timestamp);
  }
  if (event.type === "tool_use") {
    return milliseconds(event.part?.state?.time?.start) ?? milliseconds(event.timestamp);
  }
  return undefined;
}

function eventTimingDetails(events, invocationStartedAtMs) {
  const stepStarts = events
    .filter((event) => event.type === "step_start")
    .map((event) => milliseconds(event.timestamp))
    .filter((value) => value !== undefined);
  const firstStepStart = stepStarts.length > 0 ? Math.min(...stepStarts) : undefined;
  const finishTimes = events
    .filter((event) => event.type === "step_finish")
    .map((event) => milliseconds(event.timestamp))
    .filter((value) => value !== undefined);
  const actions = events
    .map((event, index) => ({ event, index, start: actionStart(event) }))
    .filter((entry) => entry.start !== undefined);
  const actionStarts = actions.map((entry) => entry.start);
  const textStarts = actions
    .filter((entry) => entry.event.type === "text")
    .map((entry) => entry.start);

  const decisionLatencies = [];
  for (const [index, event] of events.entries()) {
    if (event.type !== "step_start") continue;
    const stepStart = milliseconds(event.timestamp);
    if (stepStart === undefined) continue;
    const finishIndex = events.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index && candidate.type === "step_finish",
    );
    const starts = actions
      .filter(
        (entry) =>
          entry.index > index &&
          (finishIndex === -1 || entry.index < finishIndex),
      )
      .map((entry) => entry.start);
    if (starts.length > 0) {
      decisionLatencies.push(secondsBetween(stepStart, Math.min(...starts)));
    }
  }

  return {
    launcherStartup: secondsBetween(
      milliseconds(invocationStartedAtMs),
      firstStepStart,
    ),
    firstAction: secondsBetween(
      firstStepStart,
      actionStarts.length > 0 ? Math.min(...actionStarts) : undefined,
    ),
    firstText: secondsBetween(
      firstStepStart,
      textStarts.length > 0 ? Math.min(...textStarts) : undefined,
    ),
    modelSession: secondsBetween(
      firstStepStart,
      finishTimes.length > 0 ? Math.max(...finishTimes) : undefined,
    ),
    decisionLatencies,
  };
}

function publicTiming(details) {
  return {
    launcher_startup_seconds: details.launcherStartup,
    time_to_first_observed_action_seconds: details.firstAction,
    time_to_first_text_block_seconds: details.firstText,
    model_session_seconds: details.modelSession,
    per_step_decision_latency_seconds: {
      count: details.decisionLatencies.length,
      p50: percentile(details.decisionLatencies, 0.5),
      p90: percentile(details.decisionLatencies, 0.9),
      max: details.decisionLatencies.length > 0
        ? Math.max(...details.decisionLatencies)
        : null,
    },
  };
}

export function summarizeEventTiming(events, invocationStartedAtMs) {
  return publicTiming(eventTimingDetails(events, invocationStartedAtMs));
}

export function aggregateEventTiming(invocations) {
  const details = invocations.map(({ events, invocationStartedAtMs }) =>
    eventTimingDetails(events, invocationStartedAtMs)
  );
  const decisionLatencies = details.flatMap((item) => item.decisionLatencies);
  const first = details[0];
  const sumPresent = (selector) => {
    const values = details.map(selector).filter((value) => Number.isFinite(value));
    return values.length > 0
      ? values.reduce((total, value) => total + value, 0)
      : null;
  };
  return {
    invocation_count: details.length,
    launcher_startup_seconds: sumPresent((item) => item.launcherStartup),
    time_to_first_observed_action_seconds: first?.firstAction ?? null,
    time_to_first_text_block_seconds: first?.firstText ?? null,
    model_session_seconds: sumPresent((item) => item.modelSession),
    per_step_decision_latency_seconds: {
      count: decisionLatencies.length,
      p50: percentile(decisionLatencies, 0.5),
      p90: percentile(decisionLatencies, 0.9),
      max: decisionLatencies.length > 0 ? Math.max(...decisionLatencies) : null,
    },
    invocation_statistics: {
      launcher_startup_seconds: distribution(
        details.map((item) => item.launcherStartup),
      ),
      time_to_first_observed_action_seconds: distribution(
        details.map((item) => item.firstAction),
      ),
      time_to_first_text_block_seconds: distribution(
        details.map((item) => item.firstText),
      ),
      model_session_seconds: distribution(
        details.map((item) => item.modelSession),
      ),
    },
  };
}

function eventCost(event) {
  const value = Number(event.part?.cost ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function recomputedRequestCost(event, model) {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return eventCost(event);
  const tokens = event.part?.tokens ?? {};
  const cacheRead = Number(tokens.cache?.read ?? 0);
  const cacheWrite = Number(tokens.cache?.write ?? 0);
  const input = Number(tokens.input ?? 0);
  const output = Number(tokens.output ?? 0) + Number(tokens.reasoning ?? 0);
  if (cacheWrite > 0 && !Number.isFinite(pricing.cache_write)) {
    return eventCost(event);
  }
  const contextInput = input + cacheRead + cacheWrite;
  const longContext = Number.isFinite(pricing.long_context_threshold) &&
    contextInput > pricing.long_context_threshold;
  const inputMultiplier = longContext ? 2 : 1;
  const outputMultiplier = longContext ? 1.5 : 1;
  return (
    input * pricing.input * inputMultiplier +
    cacheRead * pricing.cache_read * inputMultiplier +
    cacheWrite * (pricing.cache_write ?? 0) * inputMultiplier +
    output * pricing.output * outputMultiplier
  ) / 1_000_000;
}

function jsonObjectEnd(source, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error("Verbose OpenCode model catalog contains incomplete JSON");
}

export function parseVerboseModelCatalog(source) {
  const result = new Map();
  let cursor = 0;
  while (cursor < source.length) {
    while (/\s/u.test(source[cursor] ?? "")) cursor += 1;
    if (cursor >= source.length) break;
    const lineEnd = source.indexOf("\n", cursor);
    if (lineEnd === -1) {
      throw new Error("Verbose OpenCode model catalog ended before model JSON");
    }
    const fullModel = source.slice(cursor, lineEnd).trim();
    if (!fullModel.includes("/")) {
      throw new Error(`Invalid model identifier in verbose catalog: ${fullModel}`);
    }
    const objectStart = source.indexOf("{", lineEnd + 1);
    if (objectStart === -1) {
      throw new Error(`Verbose catalog has no JSON for ${fullModel}`);
    }
    const objectEnd = jsonObjectEnd(source, objectStart);
    if (result.has(fullModel)) {
      throw new Error(`Verbose catalog contains duplicate model ${fullModel}`);
    }
    result.set(fullModel, JSON.parse(source.slice(objectStart, objectEnd)));
    cursor = objectEnd;
  }
  return result;
}

function routeRecord(fullModel, model) {
  const record = {
    full_model: fullModel,
    provider_id: model.providerID,
    model_id: model.id,
    api: {
      id: model.api?.id ?? null,
      url: model.api?.url ?? null,
      npm: model.api?.npm ?? null,
    },
    status: model.status ?? null,
    cost: model.cost ?? null,
    limits: model.limit ?? null,
    variants: model.variants ?? {},
    capabilities: model.capabilities ?? null,
  };
  return {
    ...record,
    sha256: createHash("sha256")
      .update(JSON.stringify(canonicalValue(record)))
      .digest("hex"),
  };
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isPlainObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]),
  );
}

export function resolveBenchmarkModelRoute(catalogSource, { model, variant }) {
  const catalog = parseVerboseModelCatalog(catalogSource);
  const entry = catalog.get(model);
  if (!entry) {
    throw new Error(`Exact benchmark model is absent from OpenCode catalog: ${model}`);
  }
  const [providerID, ...modelParts] = model.split("/");
  const modelID = modelParts.join("/");
  if (entry.providerID !== providerID) {
    throw new Error(
      `Catalog provider mismatch for ${model}: ${entry.providerID ?? "missing"}`,
    );
  }
  if (variant && !Object.hasOwn(entry.variants ?? {}, variant)) {
    throw new Error(`Model ${model} does not expose requested variant ${variant}`);
  }
  const expectedApi = EXPECTED_COMPATIBLE_APIS[providerID];
  if (expectedApi) {
    if (
      entry.id !== modelID ||
      entry.api?.id !== modelID ||
      entry.api?.npm !== expectedApi.npm ||
      entry.api?.url !== expectedApi.url
    ) {
      throw new Error(
        `Pinned ${providerID} route ${model} resolved to an unexpected API definition`,
      );
    }
  }
  return routeRecord(model, entry);
}
