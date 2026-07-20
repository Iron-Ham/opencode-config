import fs from "node:fs";
import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import {
  MAX_RESULTS,
  ignoreArguments,
  resolvePath,
  runRipgrep,
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

    const result = await runRipgrep([
      "--files",
      "--sortr",
      "modified",
      ...ignoreArguments(),
      "--glob",
      args.pattern,
      ".",
    ], searchRoot);
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return `Glob failed: ${result.stderr || "ripgrep exited unsuccessfully"}`;
    }

    const files = result.stdout.split("\n").filter(Boolean)
      .map((filePath) => path.resolve(searchRoot, filePath));
    const limited = files.slice(0, MAX_RESULTS)
      .map((filePath) => visibleRelativePath(filePath, context.directory));
    const suffix = files.length > limited.length
      ? `\n[${files.length - limited.length} additional matches omitted. Narrow the pattern or path.]`
      : "";
    const output = utf8Prefix(limited.join("\n") + suffix);
    return output.value || "No files found.";
  },
});
