#!/usr/bin/env bun

import fs from "node:fs";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import process from "node:process";


const repoRoot = path.resolve(
  process.argv[2] ?? path.join(path.dirname(new URL(import.meta.url).pathname), ".."),
);
const configDir = path.resolve(
  process.argv[3] ?? path.join(os.homedir(), ".config", "opencode"),
);
const checkOnly = process.argv.includes("--check");
const validateModelRouting = process.argv.includes("--validate-model-routing");
const backupDir = path.join(configDir, "backups", "setup-opencode");
const modelRoutingConfigPath = path.join(
  configDir,
  "model-routing.config.local.json",
);
const modelRoutingAgentNames = new Set([
  "accessibility_auditor",
  "build",
  "code_reviewer",
  "compaction",
  "database_optimizer",
  "evidence_analyst",
  "explore",
  "general",
  "luna",
  "plan",
  "security_engineer",
  "software_architect",
  "sol",
  "sonnet",
  "terra",
]);
const modelOverrideAgentNames = new Set([
  "accessibility_auditor",
  "build",
  "code_reviewer",
  "compaction",
  "database_optimizer",
  "evidence_analyst",
  "explore",
  "general",
  "plan",
  "security_engineer",
  "software_architect",
]);
const inheritedModelAgentNames = new Set([
  "accessibility_auditor",
  "build",
  "code_reviewer",
  "database_optimizer",
  "evidence_analyst",
  "explore",
  "general",
  "security_engineer",
  "software_architect",
]);
const retiredManagedAgentNames = new Set([
  "advisor_reviewer",
  "backend_architect",
  "evidence_collector",
  "frontend_developer",
  "git_workflow_master",
  "glm_worker",
  "kimi_reader",
  "periphery-fixer",
  "sol_reviewer",
  "technical_writer",
  "ultra",
]);
const retiredRoutingAgentNames = new Set([
  "advisor_reviewer",
  "glm_worker",
  "kimi_reader",
  "ultra",
]);
const retiredGoalToolNames = new Set([
  "get_goal",
  "get_goal_history",
  "create_goal",
  "set_goal",
  "update_goal_objective",
  "update_goal",
  "update_goal_status",
  "clear_goal",
  "record_goal_progress",
  "record_goal_failure",
]);
const retiredCommandNames = new Set([
  "advise",
  "glm",
  "glm-fireworks",
  "glm-fireworks-fast",
  "goal",
  "kimi",
  "kimi-fireworks",
  "kimi-fireworks-fast",
  "ultra",
]);
const retiredBasetenModelNames = new Set([
  "moonshotai/Kimi-K2.7-Code",
  "zai-org/GLM-5.2",
]);
const obsoleteInstructionPaths = new Set([
  "~/Developer/claude-config/AGENTS.md",
]);
const unsupportedOpenCodeMcps = new Set([
  "aws-app-prod-us-west-2",
  "aws-app-prod-eu-central-1",
  "aws-app-stg-us-west-2",
  "aws-app-dev-us-west-2",
  "aws-app-dev-eu-central-1",
  "aws-app-dev-ap-northeast-2",
  "aws-notion-labs-us-west-2",
  "aws-notion-labs-eu-central-1",
  "aws-network-us-west-2",
  "aws-network-eu-central-1",
  "aws-spacelift-us-west-2",
]);
const pinnedModelReplacements = new Map([
  ["openai/gpt-5.6-luna-high-pinned", "openai/gpt-5.6-luna"],
  ["openai/gpt-5.6-luna-xhigh-pinned", "openai/gpt-5.6-luna"],
  ["openai/gpt-5.6-sol-high-pinned", "openai/gpt-5.6-sol"],
  ["openai/gpt-5.6-sol-xhigh-pinned", "openai/gpt-5.6-sol"],
  ["openai/gpt-5.6-terra-xhigh-pinned", "openai/gpt-5.6-terra"],
  ["anthropic/claude-opus-4-8-xhigh-pinned", "anthropic/claude-opus-4-8"],
  ["anthropic/claude-sonnet-5-default-pinned", "anthropic/claude-sonnet-5"],
  ["anthropic/claude-sonnet-5-max-pinned", "anthropic/claude-sonnet-5"],
]);

function readJson(filePath, fallback) {
  if (!fs.existsSync(filePath)) {
    return structuredClone(fallback);
  }

  try {
    const source = fs.readFileSync(filePath, "utf8");
    return filePath.endsWith(".jsonc")
      ? Bun.JSONC.parse(source)
      : JSON.parse(source);
  } catch (error) {
    throw new Error(`Cannot parse ${filePath}: ${error.message}`);
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertProviderModel(value, label) {
  if (typeof value !== "string" || value.trim() !== value) {
    throw new Error(`${label} must be a provider/model string`);
  }
  const separator = value.indexOf("/");
  if (
    separator <= 0 ||
    separator === value.length - 1 ||
    /\s/.test(value)
  ) {
    throw new Error(`${label} must be a provider/model string`);
  }
}

function assertAgentSteps(value, label) {
  if (value === null) return;
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be null or a positive integer`);
  }
}

function unpinModel(model) {
  return pinnedModelReplacements.get(model) ?? model;
}

function removePinnedModels(config) {
  if (typeof config.model === "string") {
    config.model = unpinModel(config.model);
  }
  for (const agent of Object.values(config.agent ?? {})) {
    if (isPlainObject(agent) && typeof agent.model === "string") {
      agent.model = unpinModel(agent.model);
    }
  }
  for (const pinnedModel of pinnedModelReplacements.keys()) {
    const separator = pinnedModel.indexOf("/");
    const providerID = pinnedModel.slice(0, separator);
    const modelID = pinnedModel.slice(separator + 1);
    delete config.provider?.[providerID]?.models?.[modelID];
  }
}

function mergeManaged(existing, managed) {
  if (!isPlainObject(existing) || !isPlainObject(managed)) {
    return structuredClone(managed);
  }

  const merged = structuredClone(existing);
  for (const [key, value] of Object.entries(managed)) {
    merged[key] = key in existing
      ? mergeManaged(existing[key], value)
      : structuredClone(value);
  }
  return merged;
}

const permissionActionRank = { allow: 0, ask: 1, deny: 2 };

function stricterPermissionAction(existing, managed) {
  if (!(existing in permissionActionRank)) return managed;
  return permissionActionRank[existing] > permissionActionRank[managed]
    ? existing
    : managed;
}

function permissionMap(value) {
  if (typeof value === "string") return { "*": value };
  return isPlainObject(value) ? value : {};
}

function globPatternsMayOverlap(left, right) {
  if (/[[\]{}!]/.test(left) || /[[\]{}!]/.test(right)) return true;

  const alphabet = new Set(["\0"]);
  for (const char of `${left}${right}`) {
    if (char !== "*" && char !== "?") alphabet.add(char);
  }

  function epsilonClosure(pattern, positions) {
    const closure = new Set(positions);
    const pending = [...positions];
    while (pending.length > 0) {
      const position = pending.pop();
      if (pattern[position] === "*" && !closure.has(position + 1)) {
        closure.add(position + 1);
        pending.push(position + 1);
      }
    }
    return closure;
  }

  function transitions(pattern, positions, char) {
    const next = new Set();
    for (const position of epsilonClosure(pattern, positions)) {
      const token = pattern[position];
      if (token === "*") next.add(position);
      if (token === "?" || token === char) next.add(position + 1);
    }
    return epsilonClosure(pattern, next);
  }

  const startLeft = epsilonClosure(left, new Set([0]));
  const startRight = epsilonClosure(right, new Set([0]));
  const pending = [[startLeft, startRight]];
  const visited = new Set();

  while (pending.length > 0) {
    const [leftPositions, rightPositions] = pending.pop();
    const key = `${[...leftPositions].sort((a, b) => a - b)}|${[
      ...rightPositions,
    ].sort((a, b) => a - b)}`;
    if (visited.has(key)) continue;
    visited.add(key);

    if (leftPositions.has(left.length) && rightPositions.has(right.length)) {
      return true;
    }

    for (const char of alphabet) {
      const nextLeft = transitions(left, leftPositions, char);
      const nextRight = transitions(right, rightPositions, char);
      if (nextLeft.size > 0 && nextRight.size > 0) {
        pending.push([nextLeft, nextRight]);
      }
    }
  }

  return false;
}

function mergeManagedPermissionMap(existingValue, managedValue) {
  const existing = permissionMap(existingValue);
  const managed = permissionMap(managedValue);
  const merged = {};
  const broad = stricterPermissionAction(existing["*"], managed["*"]);
  if (broad) merged["*"] = broad;

  for (const [pattern, action] of Object.entries(existing)) {
    if (pattern === "*" || pattern in managed) continue;
    merged[pattern] = action;
  }
  for (const [pattern, action] of Object.entries(managed)) {
    if (pattern === "*") continue;
    if (pattern in existing) {
      merged[pattern] = stricterPermissionAction(existing[pattern], action);
      continue;
    }
    const stricterOverlap = Object.entries(existing).some(
      ([existingPattern, existingAction]) =>
        permissionActionRank[existingAction] > permissionActionRank[action] &&
        globPatternsMayOverlap(existingPattern, pattern),
    );
    if (stricterOverlap) continue;
    merged[pattern] = stricterPermissionAction(existing[pattern], action);
  }
  return merged;
}

function pluginSpecifier(entry) {
  return Array.isArray(entry) ? entry[0] : entry;
}

function isPackage(specifier, packageName) {
  return typeof specifier === "string" &&
    (specifier === packageName || specifier.startsWith(`${packageName}@`));
}

function mergePlugins(existing = [], managed = []) {
  const retiredPackages = [
    "@prevalentware/opencode-goal-plugin",
    "opencode-pty",
  ];
  const managedLocalPluginSpecs = new Set([
    "./plugins/goal-mode.js",
    "./plugins/goal-mode-tui.tsx",
    "./plugins/goal-workflow-guard.js",
    "./plugins/compaction-observability.js",
    "./plugins/delegation-guard.js",
  ]);
  const managedSpecs = new Set(managed.map(pluginSpecifier));
  const retained = existing.filter((entry) => {
    const specifier = pluginSpecifier(entry);
    return !managedSpecs.has(specifier) &&
      !managedLocalPluginSpecs.has(specifier) &&
      !retiredPackages.some((packageName) =>
        isPackage(specifier, packageName)
      );
  });
  return [...retained, ...structuredClone(managed)];
}

function uniqueStrings(...groups) {
  return [...new Set(groups.flat().filter((value) => typeof value === "string"))];
}

function timestamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "");
}

function privateFileMode(filePath) {
  const existingMode = fs.statSync(filePath).mode & 0o777;
  return existingMode & 0o600 || 0o600;
}

function ensurePrivateDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  fs.chmodSync(directory, 0o700);
}

function hardenTree(directory) {
  if (!fs.existsSync(directory)) {
    return;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      fs.chmodSync(entryPath, 0o700);
      hardenTree(entryPath);
    } else if (entry.isFile()) {
      fs.chmodSync(entryPath, privateFileMode(entryPath));
    }
  }
}

function backupFile(filePath) {
  ensurePrivateDirectory(backupDir);
  const backup = path.join(
    backupDir,
    `${path.basename(filePath)}.bak.${timestamp()}`,
  );
  fs.copyFileSync(filePath, backup);
  fs.chmodSync(backup, privateFileMode(filePath));
  console.log(`BACKUP ${filePath} -> ${backup}`);
}

function writeJson(filePath, value) {
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  const current = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8")
    : undefined;
  const finalMode = current === undefined ? 0o600 : privateFileMode(filePath);

  if (current === rendered) {
    fs.chmodSync(filePath, finalMode);
    console.log(`OK     ${filePath}`);
    return;
  }

  if (current !== undefined) {
    backupFile(filePath);
  }

  const directory = path.dirname(filePath);
  ensurePrivateDirectory(directory);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(filePath)}.tmp-${process.pid}-${crypto.randomUUID()}`,
  );
  let temporaryHandle;
  try {
    temporaryHandle = fs.openSync(temporaryPath, "wx", 0o600);
    fs.writeFileSync(temporaryHandle, rendered);
    fs.fsyncSync(temporaryHandle);
    fs.closeSync(temporaryHandle);
    temporaryHandle = undefined;
    fs.chmodSync(temporaryPath, finalMode);
    fs.renameSync(temporaryPath, filePath);
  } finally {
    if (temporaryHandle !== undefined) fs.closeSync(temporaryHandle);
    fs.rmSync(temporaryPath, { force: true });
  }
  console.log(`WRITE  ${filePath}`);
}

function denyAdvisor(permission) {
  if (isPlainObject(permission)) {
    return { ...permission, advisor: "deny" };
  }
  if (permission in permissionActionRank) {
    return { "*": permission, advisor: "deny" };
  }
  return { advisor: "deny" };
}

function removeRetiredFeatureConfiguration(config) {
  if (isPlainObject(config.permission)) {
    for (const toolName of retiredGoalToolNames) {
      delete config.permission[toolName];
    }
  }
  for (const agent of Object.values(config.agent ?? {})) {
    if (!isPlainObject(agent) || !isPlainObject(agent.permission)) continue;
    for (const toolName of retiredGoalToolNames) {
      delete agent.permission[toolName];
    }
  }
  if (isPlainObject(config.command)) {
    for (const commandName of retiredCommandNames) {
      delete config.command[commandName];
    }
  }
  delete config.provider?.["fireworks-ai"];
  if (isPlainObject(config.provider?.baseten)) {
    if (Array.isArray(config.provider.baseten.whitelist)) {
      config.provider.baseten.whitelist = config.provider.baseten.whitelist.filter(
        (model) => !retiredBasetenModelNames.has(model),
      );
    }
    for (const model of retiredBasetenModelNames) {
      delete config.provider.baseten.models?.[model];
    }
  }
}

function applyModelRoutingConfig(merged, config, managed) {
  merged.agent ??= {};
  for (const agentName of modelRoutingAgentNames) {
    if (
      !(agentName in config.steps) &&
      managed.agent?.[agentName]?.steps === undefined &&
      isPlainObject(merged.agent[agentName])
    ) {
      delete merged.agent[agentName].steps;
    }
  }
  for (const agentName of inheritedModelAgentNames) {
    if (
      !(agentName in config.agents) &&
      managed.agent?.[agentName]?.model === undefined &&
      isPlainObject(merged.agent[agentName])
    ) {
      delete merged.agent[agentName].model;
    }
  }
  for (const [agentName, model] of Object.entries(config.agents)) {
    merged.agent[agentName] ??= {};
    if (!isPlainObject(merged.agent[agentName])) {
      throw new Error(`agent.${agentName} must contain a JSON object`);
    }
    merged.agent[agentName].model = model;
  }
  for (const [agentName, steps] of Object.entries(config.steps)) {
    merged.agent[agentName] ??= {};
    if (!isPlainObject(merged.agent[agentName])) {
      throw new Error(`agent.${agentName} must contain a JSON object`);
    }
    if (steps === null) {
      delete merged.agent[agentName].steps;
    } else {
      merged.agent[agentName].steps = steps;
    }
  }

  merged.permission ??= {};
  merged.permission.advisor = "deny";
  for (const agent of Object.values(merged.agent)) {
    if (!isPlainObject(agent)) continue;
    agent.permission = denyAdvisor(agent.permission);
  }
}

function mergeOpenCodeConfig(modelRouting) {
  const target = path.join(configDir, "opencode.json");
  const jsoncOverride = path.join(configDir, "opencode.jsonc");
  const managed = readJson(
    path.join(repoRoot, "opencode", "opencode.defaults.json"),
    {},
  );
  const existingJson = readJson(target, {});
  const existingJsonc = fs.existsSync(jsoncOverride)
    ? readJson(jsoncOverride, {})
    : undefined;
  const existing = existingJsonc === undefined
    ? existingJson
    : mergeManaged(existingJson, existingJsonc);
  const merged = mergeManaged(existing, managed);
  removePinnedModels(merged);
  if (existing.lsp !== undefined) {
    merged.lsp = structuredClone(existing.lsp);
  }
  if (isPlainObject(merged.agent)) {
    for (const agentName of retiredManagedAgentNames) {
      delete merged.agent[agentName];
    }
  }
  if (
    typeof merged.small_model === "string" &&
    merged.small_model.startsWith("baseten/") &&
    retiredBasetenModelNames.has(merged.small_model.slice("baseten/".length))
  ) {
    delete merged.small_model;
  }
  merged.permission ??= {};
  for (const permission of ["read", "text_read", "bash"]) {
    merged.permission[permission] = mergeManagedPermissionMap(
      existing.permission?.[permission],
      managed.permission?.[permission],
    );
  }
  for (const agentName of ["plan", "general", "explore"]) {
    const managedPermission = managed.agent?.[agentName]?.permission;
    if (managedPermission) {
      merged.agent[agentName].permission = structuredClone(managedPermission);
    }
  }
  for (const agentName of ["build", "luna", "sonnet", "sol", "terra"]) {
    const managedTaskPermission = managed.agent?.[agentName]?.permission?.task;
    if (managedTaskPermission) {
      merged.agent[agentName].permission ??= {};
      merged.agent[agentName].permission.task = structuredClone(managedTaskPermission);
    }
  }
  for (const providerID of ["baseten"]) {
    if (!managed.provider?.[providerID]?.whitelist) continue;
    merged.provider[providerID].whitelist = uniqueStrings(
      existing.provider?.[providerID]?.whitelist,
      managed.provider[providerID].whitelist,
    );
  }
  const retainedInstructions = uniqueStrings(
    existing.instructions,
    managed.instructions,
  ).filter((instruction) => !obsoleteInstructionPaths.has(instruction));
  if (retainedInstructions.length === 0) {
    delete merged.instructions;
  } else {
    merged.instructions = retainedInstructions;
  }
  merged.disabled_providers = uniqueStrings(
    existing.disabled_providers,
    managed.disabled_providers,
  );
  merged.plugin = mergePlugins(existing.plugin, managed.plugin);
  if (
    managed.agent?.compaction?.model === undefined &&
    merged.agent?.compaction?.model === "anthropic/claude-sonnet-5"
  ) {
    delete merged.agent.compaction.model;
  }
  delete merged.agent?.build?.variant;
  delete merged.agent?.build?.options;
  delete merged.agent?.general?.variant;
  delete merged.agent?.general?.options;
  delete merged.agent?.plan?.variant;
  delete merged.agent?.plan?.options;
  delete merged.agent?.compaction?.variant;
  delete merged.agent?.compaction?.options;
  delete merged.agent?.luna?.variant;
  delete merged.agent?.luna?.options;
  delete merged.agent?.sonnet?.variant;
  delete merged.agent?.sonnet?.options;
  delete merged.agent?.sol?.variant;
  delete merged.agent?.sol?.options;
  delete merged.agent?.terra?.variant;
  delete merged.agent?.terra?.options;
  for (const agentName of inheritedModelAgentNames) {
    if (!(agentName in modelRouting.agents)) {
      delete merged.agent?.[agentName]?.model;
    }
  }
  applyModelRoutingConfig(merged, modelRouting, managed);
  removeRetiredFeatureConfiguration(merged);
  if (isPlainObject(merged.mcp)) {
    for (const name of Object.keys(merged.mcp)) {
      if (unsupportedOpenCodeMcps.has(name)) {
        delete merged.mcp[name];
      }
    }
  }
  writeJson(target, merged);
  if (existingJsonc !== undefined) {
    backupFile(jsoncOverride);
    fs.unlinkSync(jsoncOverride);
    console.log(`REMOVE ${jsoncOverride} (settings consolidated into opencode.json)`);
  }
}

function mergeTuiConfig() {
  const target = path.join(configDir, "tui.json");
  const managed = readJson(
    path.join(repoRoot, "opencode", "tui.defaults.json"),
    {},
  );
  const existing = readJson(target, {});
  const merged = mergeManaged(existing, managed);
  merged.plugin = mergePlugins(existing.plugin, managed.plugin);
  writeJson(target, merged);
}

function mergePackageConfig() {
  const target = path.join(configDir, "package.json");
  const managed = readJson(
    path.join(repoRoot, "opencode", "package.defaults.json"),
    {},
  );
  const existing = readJson(target, {});
  const merged = mergeManaged(existing, managed);
  for (const section of ["dependencies", "devDependencies"]) {
    delete merged[section]?.["@prevalentware/opencode-goal-plugin"];
  }
  writeJson(target, merged);
}

function modelRoutingConfig() {
  const existing = readJson(modelRoutingConfigPath, {});
  if (!isPlainObject(existing)) {
    throw new Error(`${modelRoutingConfigPath} must contain a JSON object`);
  }

  const normalizedExisting = structuredClone(existing);
  delete normalizedExisting.advisor_enabled;
  const allowedKeys = new Set([
    "policy_adapter_enabled",
    "agents",
    "steps",
  ]);
  const unknownKeys = Object.keys(normalizedExisting).filter((key) => !allowedKeys.has(key));
  if (unknownKeys.length > 0) {
    throw new Error(
      `${modelRoutingConfigPath} contains unsupported keys: ${unknownKeys.join(", ")}`,
    );
  }

  const policyAdapterEnabled = normalizedExisting.policy_adapter_enabled ?? true;
  if (typeof policyAdapterEnabled !== "boolean") {
    throw new Error(`${modelRoutingConfigPath} policy_adapter_enabled must be a boolean`);
  }

  const agents = structuredClone(normalizedExisting.agents ?? {});
  if (!isPlainObject(agents)) {
    throw new Error(`${modelRoutingConfigPath} agents must contain a JSON object`);
  }
  for (const agentName of retiredRoutingAgentNames) {
    delete agents[agentName];
  }
  const normalizedAgents = {};
  for (const [agentName, model] of Object.entries(agents)) {
    if (!modelOverrideAgentNames.has(agentName)) {
      throw new Error(
        `${modelRoutingConfigPath} cannot override fixed or unsupported agent ${agentName}`,
      );
    }
    assertProviderModel(model, `${modelRoutingConfigPath} agents.${agentName}`);
    normalizedAgents[agentName] = unpinModel(model);
  }

  const steps = structuredClone(normalizedExisting.steps ?? {});
  if (!isPlainObject(steps)) {
    throw new Error(`${modelRoutingConfigPath} steps must contain a JSON object`);
  }
  for (const agentName of retiredRoutingAgentNames) {
    delete steps[agentName];
  }
  for (const [agentName, maximum] of Object.entries(steps)) {
    if (!modelRoutingAgentNames.has(agentName)) {
      throw new Error(
        `${modelRoutingConfigPath} cannot override steps for unsupported agent ${agentName}`,
      );
    }
    assertAgentSteps(maximum, `${modelRoutingConfigPath} steps.${agentName}`);
  }

  return {
    policy_adapter_enabled: policyAdapterEnabled,
    agents: normalizedAgents,
    steps: structuredClone(steps),
  };
}

function modelMetadata(output, model) {
  const lines = output.split(/\r?\n/);
  const modelLine = lines.findIndex((line) => line === model);
  if (modelLine === -1) return undefined;
  const source = lines.slice(modelLine + 1).join("\n");
  const start = source.indexOf("{");
  if (start === -1) return undefined;

  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        quoted = false;
      }
      continue;
    }
    if (character === '"') {
      quoted = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return JSON.parse(source.slice(start, index + 1));
      }
    }
  }
  return undefined;
}

const modelCatalogByProvider = new Map();

function availableModelMetadata(model, label) {
  const provider = model.slice(0, model.indexOf("/"));
  let output = modelCatalogByProvider.get(provider);
  if (output === undefined) {
    const result = Bun.spawnSync([
      "opencode",
      "models",
      provider,
      "--verbose",
      "--pure",
    ], {
      cwd: os.tmpdir(),
      env: { ...process.env, OPENCODE_CONFIG_DIR: configDir },
      stdout: "pipe",
      stderr: "pipe",
    });
    if (result.exitCode !== 0) {
      throw new Error("Cannot validate the configured provider model catalog");
    }
    output = result.stdout.toString();
    modelCatalogByProvider.set(provider, output);
  }

  const metadata = modelMetadata(output, model);
  if (!metadata) {
    throw new Error(`${label} is not available from its configured provider catalog`);
  }
  return metadata;
}

function validateModelRoutingAgainstModelCatalog(config) {
  for (const [agentName, model] of Object.entries(config.agents)) {
    availableModelMetadata(model, `Model-routing override for ${agentName}`);
  }
}

function mergeModelRoutingConfig(config) {
  writeJson(modelRoutingConfigPath, config);
}

function validateInputs() {
  const files = [
    path.join(repoRoot, "opencode", "opencode.defaults.json"),
    path.join(repoRoot, "opencode", "tui.defaults.json"),
    path.join(repoRoot, "opencode", "package.defaults.json"),
    path.join(configDir, "opencode.json"),
    path.join(configDir, "opencode.jsonc"),
    path.join(configDir, "tui.json"),
    path.join(configDir, "package.json"),
    modelRoutingConfigPath,
  ];
  for (const filePath of files) {
    readJson(filePath, {});
  }
  const modelRouting = modelRoutingConfig();
  if (validateModelRouting && modelRouting.policy_adapter_enabled) {
    validateModelRoutingAgainstModelCatalog(modelRouting);
  }
  return { modelRouting };
}

if (checkOnly) {
  validateInputs();
  console.log("OK     OpenCode JSON and JSONC inputs");
  process.exit(0);
}

ensurePrivateDirectory(configDir);
ensurePrivateDirectory(backupDir);
hardenTree(backupDir);

const validatedConfig = validateInputs();
mergeOpenCodeConfig(validatedConfig.modelRouting);
mergeTuiConfig();
mergePackageConfig();
mergeModelRoutingConfig(validatedConfig.modelRouting);
