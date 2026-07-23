import fs from "node:fs";
import path from "node:path";

export const MAX_RESULTS = 50;
export const MAX_OUTPUT_BYTES = 8_192;
export const MAX_MATCH_TEXT_BYTES = MAX_OUTPUT_BYTES - 512;
const CONTEXT_TOOL_FILE_TYPE = "opencodecontext";

export function positiveInteger(value: unknown, fallback: number, maximum: number) {
  if (!Number.isInteger(value) || Number(value) < 1) return fallback;
  return Math.min(Number(value), maximum);
}

export function resolvePath(candidate: string | undefined, directory: string) {
  return path.resolve(directory, candidate || ".");
}

export function resolveSearchPath(candidate: string | undefined, directory: string) {
  const resolved = resolvePath(candidate, directory);
  if (!isPathWithinDirectory(resolved, directory)) {
    throw new Error("Search path must stay within the active workspace.");
  }
  const stat = fs.lstatSync(resolved, { throwIfNoEntry: false });
  if (stat) {
    const root = fs.realpathSync(directory);
    const target = fs.realpathSync(resolved);
    if (!isPathWithinDirectory(target, root)) {
      throw new Error("Search path must stay within the active workspace.");
    }
  }
  return resolved;
}

export function isPathWithinDirectory(filePath: string, directory: string) {
  const relative = path.relative(directory, filePath);
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

export function visibleRelativePath(filePath: string, directory: string) {
  const relative = path.relative(directory, filePath);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== ".."
    ? relative
    : filePath;
}

export function isProtectedEnvironmentPath(filePath: string) {
  const components = filePath.split(path.sep);
  return components.some((name, index) => {
    const isFinalComponent = index === components.length - 1;
    if (isFinalComponent && (name === ".env.example" || name.endsWith(".env.example"))) {
      return false;
    }
    return name === ".env" ||
      name === ".envrc" ||
      name === ".env.d" ||
      name.startsWith(".env.");
  });
}

export function createPathGlobMatcher(pattern: string) {
  const negated = pattern.startsWith("!");
  const expression = (negated ? pattern.slice(1) : pattern).replace(/^\.\//, "");
  if (!expression) return () => false;

  const glob = new Bun.Glob(expression);
  return (relativePath: string) => {
    const normalizedPath = relativePath.split(path.sep).join("/");
    const matches = glob.match(normalizedPath) ||
      (!expression.includes("/") && glob.match(path.posix.basename(normalizedPath)));
    return negated ? !matches : matches;
  };
}

export function ripgrepTypeFilterArguments(pattern: string) {
  const expression = pattern.replace(/^\.\//, "");
  if (!expression || expression.startsWith("!") || expression.includes("/")) return [];
  return [
    "--type-add",
    `${CONTEXT_TOOL_FILE_TYPE}:${expression}`,
    "--type",
    CONTEXT_TOOL_FILE_TYPE,
  ];
}

export function truncateMatchText(value: string, matchStart?: number) {
  const text = value.endsWith("\n")
    ? value.slice(0, value.endsWith("\r\n") ? -2 : -1)
    : value;
  const encoded = Buffer.from(text, "utf8");
  if (encoded.byteLength <= MAX_MATCH_TEXT_BYTES) return text;

  const prefix = "[...]";
  const suffix = " ... [line truncated]";
  const available = MAX_MATCH_TEXT_BYTES -
    Buffer.byteLength(prefix, "utf8") -
    Buffer.byteLength(suffix, "utf8");
  const focus = typeof matchStart === "number" && Number.isSafeInteger(matchStart)
    ? Math.min(Math.max(matchStart, 0), encoded.byteLength)
    : 0;
  let start = Math.max(
    0,
    Math.min(focus - Math.floor(available / 2), encoded.byteLength - available),
  );
  while (start < encoded.byteLength && (encoded[start] & 0xc0) === 0x80) start += 1;
  let end = Math.min(encoded.byteLength, start + available);
  while (end > start && (encoded[end] & 0xc0) === 0x80) end -= 1;
  return `${start > 0 ? prefix : ""}${encoded.subarray(start, end).toString("utf8")}${end < encoded.byteLength ? suffix : ""}`;
}

export function utf8Prefix(value: string, maximumBytes = MAX_OUTPUT_BYTES) {
  const encoded = Buffer.from(value, "utf8");
  if (encoded.byteLength <= maximumBytes) return { value, truncated: false };
  const suffix = "\n[Output truncated. Narrow the query or scope the path.]";
  const available = maximumBytes - Buffer.byteLength(suffix, "utf8");
  let end = Math.max(0, available);
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end -= 1;
  return { value: `${encoded.subarray(0, end).toString("utf8")}${suffix}`, truncated: true };
}

export function sortedDirectoryEntries(directory: string) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((entry) => `${entry.name}${entry.isDirectory() ? "/" : ""}`);
}

export function isBinary(content: Buffer) {
  return content.includes(0);
}

export async function runCommandLines(
  command: string[],
  directory: string,
  onLine: (line: string) => boolean,
) {
  const process = Bun.spawn(command, {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderrPromise = new Response(process.stderr).text();
  const reader = process.stdout.getReader();
  const decoder = new TextDecoder();
  let remainder = "";
  let stopped = false;
  while (!stopped) {
    const { done, value } = await reader.read();
    remainder += decoder.decode(value, { stream: !done });
    let newline = remainder.indexOf("\n");
    while (newline >= 0) {
      if (!onLine(remainder.slice(0, newline))) {
        stopped = true;
        process.kill();
        await reader.cancel();
        break;
      }
      remainder = remainder.slice(newline + 1);
      newline = remainder.indexOf("\n");
    }
    if (done) break;
  }
  if (!stopped && remainder) onLine(remainder);
  const [exitCode, stderr] = await Promise.all([process.exited, stderrPromise]);
  return { exitCode, stderr: stderr.trim(), stopped };
}

export function runRipgrepLines(
  args: string[],
  directory: string,
  onLine: (line: string) => boolean,
) {
  return runCommandLines(["rg", "--no-config", ...args], directory, onLine);
}

export function ignoreArguments() {
  return ["--hidden", "--glob", "!.git", "--glob", "!.git/**"];
}
