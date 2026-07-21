import fs from "node:fs";
import path from "node:path";

export const MAX_RESULTS = 50;
export const MAX_OUTPUT_BYTES = 8_192;
export const MAX_MATCH_TEXT_BYTES = 1_024;

export function positiveInteger(value: unknown, fallback: number, maximum: number) {
  if (!Number.isInteger(value) || Number(value) < 1) return fallback;
  return Math.min(Number(value), maximum);
}

export function resolvePath(candidate: string | undefined, directory: string) {
  return path.resolve(directory, candidate || ".");
}

export function visibleRelativePath(filePath: string, directory: string) {
  const relative = path.relative(directory, filePath);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== ".."
    ? relative
    : filePath;
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

export function truncateMatchText(value: string) {
  const text = value.endsWith("\n")
    ? value.slice(0, value.endsWith("\r\n") ? -2 : -1)
    : value;
  const encoded = Buffer.from(text, "utf8");
  if (encoded.byteLength <= MAX_MATCH_TEXT_BYTES) return text;

  const suffix = " ... [line truncated]";
  let end = MAX_MATCH_TEXT_BYTES - Buffer.byteLength(suffix, "utf8");
  while (end > 0 && (encoded[end] & 0xc0) === 0x80) end -= 1;
  return `${encoded.subarray(0, end).toString("utf8")}${suffix}`;
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
