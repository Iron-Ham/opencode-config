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
const backupDir = path.join(configDir, "backups", "setup-opencode");
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
  const managedPackages = ["@prevalentware/opencode-goal-plugin"];
  const retained = existing.filter((entry) => {
    const specifier = pluginSpecifier(entry);
    return !managedPackages.some((packageName) =>
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

function mergeOpenCodeConfig() {
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
  if (merged.small_model === "baseten/moonshotai/Kimi-K2.7-Code") {
    delete merged.small_model;
  }
  merged.permission ??= {};
  for (const permission of ["read", "bash"]) {
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
  if (managed.provider?.baseten?.whitelist) {
    merged.provider.baseten.whitelist = uniqueStrings(
      existing.provider?.baseten?.whitelist,
      managed.provider.baseten.whitelist,
    );
  }
  for (const [providerID, modelID] of [
    ["openai", "gpt-5.6-luna-xhigh-pinned"],
    ["openai", "gpt-5.6-terra-xhigh-pinned"],
    ["anthropic", "claude-sonnet-5-default-pinned"],
    ["anthropic", "claude-sonnet-5-max-pinned"],
  ]) {
    const managedModel = managed.provider?.[providerID]?.models?.[modelID];
    if (!managedModel) continue;
    merged.provider ??= {};
    merged.provider[providerID] ??= {};
    merged.provider[providerID].models ??= {};
    merged.provider[providerID].models[modelID] = structuredClone(managedModel);
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
  delete merged.agent?.build?.variant;
  delete merged.agent?.build?.options;
  delete merged.agent?.general?.variant;
  delete merged.agent?.general?.options;
  delete merged.agent?.compaction?.variant;
  delete merged.agent?.compaction?.options;
  delete merged.agent?.ultra?.variant;
  delete merged.agent?.ultra?.options;
  delete merged.agent?.luna?.variant;
  delete merged.agent?.luna?.options;
  delete merged.agent?.sonnet?.variant;
  delete merged.agent?.sonnet?.options;
  delete merged.agent?.terra?.variant;
  delete merged.agent?.terra?.options;
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
  writeJson(target, mergeManaged(existing, managed));
}

function mergeAdvisorConfig() {
  const target = path.join(
    configDir,
    "plugins",
    "advisor.config.local.json",
  );
  const managed = readJson(
    path.join(
      repoRoot,
      "opencode",
      "advisor.config.local.defaults.json",
    ),
    {},
  );
  const existing = readJson(target, {});
  writeJson(target, mergeManaged(existing, managed));
}

function validateInputs() {
  const files = [
    path.join(repoRoot, "opencode", "opencode.defaults.json"),
    path.join(repoRoot, "opencode", "tui.defaults.json"),
    path.join(repoRoot, "opencode", "package.defaults.json"),
    path.join(repoRoot, "opencode", "advisor.config.local.defaults.json"),
    path.join(configDir, "opencode.json"),
    path.join(configDir, "opencode.jsonc"),
    path.join(configDir, "tui.json"),
    path.join(configDir, "package.json"),
    path.join(configDir, "plugins", "advisor.config.local.json"),
  ];
  for (const filePath of files) {
    readJson(filePath, {});
  }
}

if (checkOnly) {
  validateInputs();
  console.log("OK     OpenCode JSON and JSONC inputs");
  process.exit(0);
}

ensurePrivateDirectory(configDir);
ensurePrivateDirectory(backupDir);
hardenTree(backupDir);

mergeOpenCodeConfig();
mergeTuiConfig();
mergePackageConfig();
mergeAdvisorConfig();
