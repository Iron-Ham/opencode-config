import fs from "node:fs";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import {
  createPathGlobMatcher,
  isPathWithinDirectory,
  MAX_RESULTS,
  ignoreArguments,
  resolvePath,
  ripgrepTypeFilterArguments,
  runRipgrepLines,
  utf8Prefix,
  visibleRelativePath,
} from "../context-tools-lib/runtime";

export default tool({
  description: "Find files matching a glob pattern. Results are bounded and include a truncation hint.",
  args: {
    pattern: tool.schema.string().describe("Glob pattern to match files against"),
    path: tool.schema.string().optional().describe("Directory to search in"),
  },
  async execute(args, context) {
    const searchRoot = resolvePath(args.path, context.directory);
    try {
      if (!fs.statSync(searchRoot).isDirectory()) {
        return `Path is not a directory: ${searchRoot}`;
      }
    } catch {
      return `Path does not exist: ${searchRoot}`;
    }
    const searchDirectory = path.resolve(searchRoot) === path.resolve(context.directory)
      ? searchRoot
      : path.dirname(searchRoot);

    const filterArguments = ripgrepTypeFilterArguments(args.pattern);
    let matchesPath: ((relativePath: string) => boolean) | undefined;
    if (filterArguments.length === 0) {
      try {
        matchesPath = createPathGlobMatcher(args.pattern);
      } catch {
        return `Invalid glob pattern: ${args.pattern}`;
      }
    }

    const files: string[] = [];
    const result = await runRipgrepLines([
      "--files",
      "--sortr",
      "modified",
      ...filterArguments,
      ...ignoreArguments(),
      ".",
    ], searchDirectory, (line) => {
      if (!line) return true;
      const filePath = path.resolve(searchDirectory, line);
      const relativePath = path.relative(searchRoot, filePath);
      if (!isPathWithinDirectory(filePath, searchRoot)) return true;
      if (matchesPath && !matchesPath(relativePath)) return true;
      if (files.length >= MAX_RESULTS) return false;
      files.push(filePath);
      return true;
    });
    if (!result.stopped && result.exitCode !== 0 && result.exitCode !== 1) {
      return `Glob failed: ${result.stderr || "ripgrep exited unsuccessfully"}`;
    }

    const limited = files.map((filePath) => visibleRelativePath(filePath, context.directory));
    const suffix = result.stopped
      ? "\n[Additional matches omitted. Narrow the pattern or path.]"
      : "";
    const output = utf8Prefix(limited.join("\n") + suffix);
    return output.value || "No files found.";
  },
});
