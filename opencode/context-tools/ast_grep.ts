import path from "node:path";
import { tool } from "@opencode-ai/plugin";
import {
  MAX_RESULTS,
  resolvePath,
  runCommandLines,
  utf8Prefix,
  visibleRelativePath,
} from "../context-tools-lib/runtime";

export default tool({
  description: "Search source code by AST structure. Use for language-aware patterns such as calls, declarations, or JSX structures; use grep for plain text.",
  args: {
    pattern: tool.schema.string().describe("ast-grep structural pattern, using $META and $$$MULTI metavariables when needed"),
    language: tool.schema.string().describe("ast-grep language, for example typescript, tsx, swift, kotlin, rust, go, or json"),
    path: tool.schema.string().optional().describe("Directory or file to search in"),
  },
  async execute(args, context) {
    const searchRoot = resolvePath(args.path, context.directory);
    const matches: string[] = [];
    const result = await runCommandLines([
      "ast-grep",
      "run",
      "--lang",
      args.language,
      "--pattern",
      args.pattern,
      "--json=stream",
      searchRoot,
    ], context.directory, (line) => {
      if (!line) return true;
      let match: { file?: string; range?: { start?: { line?: number; column?: number } }; text?: string };
      try {
        match = JSON.parse(line);
      } catch {
        return true;
      }
      if (!match.file || !match.range?.start) return true;
      if (matches.length >= MAX_RESULTS) return false;
      const snippet = (match.text ?? "").replace(/\s+/g, " ").slice(0, 300);
      matches.push(`${visibleRelativePath(path.resolve(match.file), context.directory)}:${(match.range.start.line ?? 0) + 1}:${(match.range.start.column ?? 0) + 1}: ${snippet}`);
      return true;
    });
    if (!result.stopped && result.exitCode !== 0 && result.exitCode !== 1) {
      return `AST search failed: ${result.stderr || "ast-grep exited unsuccessfully"}`;
    }
    if (matches.length === 0) return "No structural matches found.";
    const suffix = result.stopped
      ? "\n[Additional matches omitted. Narrow the pattern or path.]"
      : "";
    return utf8Prefix(matches.join("\n") + suffix).value;
  },
});
