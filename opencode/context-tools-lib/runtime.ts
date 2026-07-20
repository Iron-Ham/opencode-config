import fs from "node:fs";
import path from "node:path";

export const MAX_RESULTS = 50;
export const MAX_OUTPUT_BYTES = 8_192;

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

export async function runRipgrep(args: string[], directory: string) {
  const process = Bun.spawn(["rg", ...args], {
    cwd: directory,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);
  return { exitCode, stdout, stderr: stderr.trim() };
}

export function ignoreArguments() {
  return ["--hidden", "--glob", "!.git/**"];
}
