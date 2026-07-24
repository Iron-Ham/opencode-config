#!/usr/bin/env bun

import fs from "node:fs";
import path from "node:path";

const [, , profilePath, configPath] = process.argv;
if (!profilePath || !configPath) {
  console.error("Usage: merge-omp-config.mjs <profile> <config>");
  process.exit(2);
}

function readConfig(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const source = fs.readFileSync(filePath, "utf8");
  if (!source.trim()) return {};
  const value = path.extname(filePath).toLowerCase() === ".json"
    ? JSON.parse(source)
    : Bun.YAML.parse(source);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filePath} must contain a configuration object`);
  }
  return value;
}

function mergeObjects(base, overlay) {
  const result = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] !== null &&
      typeof result[key] === "object" &&
      !Array.isArray(result[key])
    ) {
      result[key] = mergeObjects(result[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

const profile = readConfig(profilePath);
const current = readConfig(configPath);
const merged = mergeObjects(current, profile);

// Advisor assignment is intentionally unassigned. Other user-defined roles stay intact.
if (merged.modelRoles && typeof merged.modelRoles === "object") {
  delete merged.modelRoles.advisor;
}

// OMP 17 uses xdev for discoverable tools. Remove keys emitted by an earlier
// profile draft because this version's schema does not recognize them.
if (merged.tools && typeof merged.tools === "object") {
  delete merged.tools.discoveryMode;
  delete merged.tools.essentialOverride;
}

const directory = path.dirname(configPath);
fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
const temporaryPath = `${configPath}.tmp-${process.pid}`;
const output = path.extname(configPath).toLowerCase() === ".json"
  ? `${JSON.stringify(merged, null, 2)}\n`
  : Bun.YAML.stringify(merged, null, 2);
fs.writeFileSync(temporaryPath, output, { mode: 0o600 });
fs.chmodSync(temporaryPath, 0o600);
fs.renameSync(temporaryPath, configPath);
fs.chmodSync(configPath, 0o600);
