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
    const searchDirectory = stat.isDirectory() ? searchRoot : path.dirname(searchRoot);
    const target = stat.isDirectory() ? "." : path.basename(searchRoot);
    const result = await runRipgrep([
      "--json",
      "--line-number",
      "--column",
      "--color",
      "never",
      ...ignoreArguments(),
      ...(args.include ? ["--glob", args.include] : []),
      "--",
      args.pattern,
      target,
    ], searchDirectory);
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      return `Search failed: ${result.stderr || "ripgrep exited unsuccessfully"}`;
    }

    const matches: string[] = [];
    let total = 0;
    for (const line of result.stdout.split("\n")) {
      if (!line) continue;
      let event: { type?: string; data?: { path?: { text?: string }; line_number?: number; absolute_offset?: number; lines?: { text?: string }; submatches?: Array<{ start?: number }> } };
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type !== "match") continue;
      total += 1;
      if (matches.length >= MAX_RESULTS) continue;
      const data = event.data;
      const filePath = data?.path?.text;
      if (!filePath || !data?.line_number) continue;
      const column = (data.submatches?.[0]?.start ?? 0) + 1;
      const text = data.lines?.text?.replace(/\r?\n$/, "") ?? "";
      matches.push(`${visibleRelativePath(path.resolve(searchDirectory, filePath), context.directory)}:${data.line_number}:${column}: ${text}`);
    }
    if (matches.length === 0) return "No matches found.";
    const suffix = total > matches.length
      ? `\n[${total - matches.length} additional matches omitted. Narrow the pattern or path.]`
      : "";
    return utf8Prefix(matches.join("\n") + suffix).value;
  },
});
