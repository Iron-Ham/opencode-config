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
  truncateMatchText,
  utf8Prefix,
  visibleRelativePath,
} from "../context-tools-lib/runtime";

export default tool({
  description: "Search file contents using a regular expression. Results are bounded with file, line, and column information.",
  args: {
    pattern: tool.schema.string().describe("Regular expression to search for"),
    path: tool.schema.string().optional().describe("Directory or file to search in"),
    include: tool.schema.string().optional().describe("Optional glob restricting searched files"),
  },
  async execute(args, context) {
    const searchRoot = resolvePath(args.path, context.directory);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(searchRoot);
    } catch {
      return `Path does not exist: ${searchRoot}`;
    }
    const searchRootIsDirectory = stat.isDirectory();
    const searchDirectory = searchRootIsDirectory &&
        path.resolve(searchRoot) === path.resolve(context.directory)
      ? searchRoot
      : path.dirname(searchRoot);
    const filterArguments = args.include
      ? ripgrepTypeFilterArguments(args.include)
      : [];
    let matchesPath: ((relativePath: string) => boolean) | undefined;
    if (args.include && filterArguments.length === 0) {
      try {
        matchesPath = createPathGlobMatcher(args.include);
      } catch {
        return `Invalid glob pattern: ${args.include}`;
      }
    }
    const matches: string[] = [];
    const result = await runRipgrepLines([
      "--json",
      "--line-number",
      "--column",
      "--color",
      "never",
      ...filterArguments,
      ...ignoreArguments(),
      "--",
      args.pattern,
      ".",
    ], searchDirectory, (line) => {
      if (!line) return true;
      let event: { type?: string; data?: { path?: { text?: string }; line_number?: number; lines?: { text?: string }; submatches?: Array<{ start?: number }> } };
      try {
        event = JSON.parse(line);
      } catch {
        return true;
      }
      if (event.type !== "match") return true;
      if (matches.length >= MAX_RESULTS) return false;
      const data = event.data;
      const filePath = data?.path?.text;
      if (!filePath || !data?.line_number) return true;
      const absoluteFilePath = path.resolve(searchDirectory, filePath);
      const relativePath = path.relative(searchRoot, absoluteFilePath);
      if (!isPathWithinDirectory(absoluteFilePath, searchRoot)) return true;
      const matchPath = searchRootIsDirectory
        ? relativePath
        : path.basename(searchRoot);
      if (matchesPath && !matchesPath(matchPath)) return true;
      const column = (data.submatches?.[0]?.start ?? 0) + 1;
      const text = truncateMatchText(
        data.lines?.text ?? "",
        data.submatches?.[0]?.start,
      );
      matches.push(`${visibleRelativePath(absoluteFilePath, context.directory)}:${data.line_number}:${column}: ${text}`);
      return true;
    });
    if (!result.stopped && result.exitCode !== 0 && result.exitCode !== 1) {
      return `Search failed: ${result.stderr || "ripgrep exited unsuccessfully"}`;
    }

    if (matches.length === 0) return "No matches found.";
    const suffix = result.stopped
      ? "\n[Additional matches omitted. Narrow the pattern or path.]"
      : "";
    return utf8Prefix(matches.join("\n") + suffix).value;
  },
});
