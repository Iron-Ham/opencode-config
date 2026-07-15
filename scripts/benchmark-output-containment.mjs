import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CLAUDE_CONFIG_GIT_ROOT = fs.realpathSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
);

function canonicalizePotentialPath(candidate) {
  const absolute = path.resolve(candidate);
  const missingSegments = [];
  let ancestor = absolute;

  while (fs.lstatSync(ancestor, { throwIfNoEntry: false }) === undefined) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) {
      throw new Error(`Cannot resolve benchmark output path: ${candidate}`);
    }
    missingSegments.unshift(path.basename(ancestor));
    ancestor = parent;
  }

  return path.resolve(fs.realpathSync(ancestor), ...missingSegments);
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

export function assertRawBenchmarkOutputOutsideRepository(outputDir) {
  const resolvedOutput = canonicalizePotentialPath(outputDir);
  if (isPathInside(CLAUDE_CONFIG_GIT_ROOT, resolvedOutput)) {
    throw new Error(
      "raw benchmark --output-dir must resolve outside the claude-config Git root",
    );
  }
  return resolvedOutput;
}
