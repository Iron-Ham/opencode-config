import fs from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";

import {
  MAX_OUTPUT_BYTES,
  positiveInteger,
  resolvePath,
  visibleRelativePath,
} from "./runtime";

export const DEFAULT_TEXT_READ_LIMIT = 200;
export const MAX_TEXT_READ_LIMIT = 2_000;
export const MAX_TEXT_READ_LINE_CHARACTERS = 1_024;
export const MAX_DIRECTORY_SCAN_ENTRIES = 10_000;

const SAMPLE_BYTES = 4_096;
const OUTPUT_FOOTER_BYTES = 512;
const OUTPUT_CONTENT_BYTES = MAX_OUTPUT_BYTES - OUTPUT_FOOTER_BYTES;
const WILDCARD_META_CHARACTERS = /[*?]/;

type TextReadPermission = {
  permission: "external_directory" | "read";
  patterns: string[];
  always: string[];
  metadata: Record<string, unknown>;
};

export type TextReadContext = {
  directory: string;
  worktree: string;
  abort?: AbortSignal;
  ask(input: TextReadPermission): Promise<unknown>;
};

export type TextReadArgs = {
  filePath: string;
  offset?: number;
  limit?: number;
};

type OutputState = {
  lines: string[];
  bytes: number;
};

function normalizedArgs(input: TextReadArgs) {
  return {
    filePath: input.filePath,
    offset: positiveInteger(input.offset, 1, Number.MAX_SAFE_INTEGER),
    limit: positiveInteger(
      input.limit,
      DEFAULT_TEXT_READ_LIMIT,
      MAX_TEXT_READ_LIMIT,
    ),
  };
}

function displayPath(filePath: string, directory: string) {
  return visibleRelativePath(filePath, directory)
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n");
}

function canonicalRoot(directory: string) {
  try {
    return fs.realpathSync(directory);
  } catch {
    return path.resolve(directory);
  }
}

function isWithin(root: string, target: string) {
  const resolvedRoot = canonicalRoot(root);
  if (resolvedRoot === path.parse(resolvedRoot).root) return false;
  const relative = path.relative(resolvedRoot, target);
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function isWithinSession(context: TextReadContext, target: string) {
  return isWithin(context.directory, target) || isWithin(context.worktree, target);
}

function permissionPath(filePath: string) {
  const normalized = process.platform === "win32"
    ? filePath.replaceAll("\\", "/")
    : filePath;
  if (WILDCARD_META_CHARACTERS.test(normalized)) {
    throw new Error(`Cannot request a safe read permission for path: ${filePath}`);
  }
  return normalized;
}

function directoryPermissionPattern(directory: string) {
  const normalized = permissionPath(directory).replace(/\/+$/, "");
  return normalized ? `${normalized}/*` : "/*";
}

async function requestReadPermission(
  context: TextReadContext,
  requestedPath: string,
  accessPath: string,
  kind: "file" | "directory",
  offset: number,
  limit: number,
) {
  const safeAccessPath = permissionPath(accessPath);
  if (!isWithinSession(context, accessPath)) {
    const parentDirectory = kind === "directory"
      ? accessPath
      : path.dirname(accessPath);
    const pattern = directoryPermissionPattern(parentDirectory);
    await context.ask({
      permission: "external_directory",
      patterns: [pattern],
      always: [pattern],
      metadata: {
        filePath: requestedPath,
        accessPath,
        kind,
      },
    });
  }

  await context.ask({
    permission: "read",
    patterns: [safeAccessPath],
    always: [safeAccessPath],
    metadata: {
      filePath: requestedPath,
      accessPath,
      offset,
      limit,
    },
  });
}

function appendOutputLine(state: OutputState, line: string) {
  const bytes = Buffer.byteLength(line, "utf8") + (state.lines.length > 0 ? 1 : 0);
  if (state.bytes + bytes > OUTPUT_CONTENT_BYTES) return false;
  state.lines.push(line);
  state.bytes += bytes;
  return true;
}

function textOutput(
  state: OutputState,
  input: {
    offset: number;
    lastLine: number;
    hasMore: boolean;
    byteCapped: boolean;
    lineCapped: boolean;
    totalLines: number;
  },
) {
  if (state.lines.length === 0) {
    if (input.totalLines === 0) return "[Empty file.]";
    return `Offset ${input.offset} is out of range for this file (${input.totalLines} lines).`;
  }

  const footer = input.hasMore
    ? `[Showing lines ${input.offset}-${input.lastLine}. Use offset=${input.lastLine + 1} to continue if more remains.]`
    : `[End of file after line ${input.lastLine}.]`;
  const notes = [footer];
  if (input.byteCapped) notes.push("[Output capped by byte budget.]");
  if (input.lineCapped) {
    notes.push(
      `[Long lines were truncated to ${MAX_TEXT_READ_LINE_CHARACTERS} characters.]`,
    );
  }
  return `${state.lines.join("\n")}\n${notes.join("\n")}`;
}

function directoryOutput(
  state: OutputState,
  input: {
    offset: number;
    lastEntry: number;
    hasMore: boolean;
    byteCapped: boolean;
    totalEntries: number;
    bounded: boolean;
  },
) {
  if (state.lines.length === 0) {
    if (input.totalEntries === 0) return "[Empty directory.]";
    return `Offset ${input.offset} is out of range for this directory (${input.totalEntries} entries).`;
  }

  const footer = input.bounded
    ? `[Directory scan capped at ${MAX_DIRECTORY_SCAN_ENTRIES} entries. Use Glob to narrow this directory.]`
    : input.hasMore
      ? `[Showing entries ${input.offset}-${input.lastEntry}. Use offset=${input.lastEntry + 1} to continue.]`
      : `[End of directory after entry ${input.lastEntry}.]`;
  const notes = [footer];
  if (input.byteCapped) notes.push("[Output capped by byte budget.]");
  return `${state.lines.join("\n")}\n${notes.join("\n")}`;
}

function sniffMedia(sample: Buffer) {
  if (sample.subarray(0, 5).toString("ascii") === "%PDF-") return "PDF";
  if (sample.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image";
  if (sample.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image";
  if (["GIF87a", "GIF89a"].includes(sample.subarray(0, 6).toString("ascii"))) return "image";
  if (sample.subarray(0, 2).toString("ascii") === "BM") return "image";
  if (
    sample.subarray(0, 4).toString("ascii") === "RIFF" &&
    sample.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image";
  return undefined;
}

function isLikelyBinary(sample: Buffer, complete: boolean) {
  if (sample.length === 0) return false;
  if (sample.includes(0)) return true;
  let index = sample.length;
  while (index > 0 && (sample[index - 1] & 0xc0) === 0x80) index -= 1;
  const leading = sample[index - 1];
  const sequenceLength = leading >= 0xc2 && leading <= 0xdf
    ? 2
    : leading >= 0xe0 && leading <= 0xef
      ? 3
      : leading >= 0xf0 && leading <= 0xf4
      ? 4
        : 1;
  // A fixed-size sample may end before a valid multi-byte sequence finishes.
  const completePrefix = !complete && sequenceLength > sample.length - index + 1
    ? sample.subarray(0, index - 1)
    : sample;
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(completePrefix);
  } catch {
    return true;
  }

  let controls = 0;
  for (const byte of sample) {
    if (byte < 9 || (byte > 13 && byte < 32)) controls += 1;
  }
  return controls / sample.length > 0.3;
}

function readSample(filePath: string, size: number) {
  const length = Math.min(SAMPLE_BYTES, size);
  if (length === 0) return Buffer.alloc(0);
  const handle = fs.openSync(filePath, "r");
  try {
    const sample = Buffer.alloc(length);
    const bytesRead = fs.readSync(handle, sample, 0, length, 0);
    return sample.subarray(0, bytesRead);
  } finally {
    fs.closeSync(handle);
  }
}

function appendLineSegment(
  value: string,
  state: { value: string; truncated: boolean },
) {
  if (!value || state.truncated) return;
  const remaining = MAX_TEXT_READ_LINE_CHARACTERS - state.value.length;
  if (remaining <= 0) {
    state.truncated = true;
    return;
  }
  if (value.length <= remaining) {
    state.value += value;
    return;
  }
  let end = remaining;
  if (
    end > 0 &&
    end < value.length &&
    value.charCodeAt(end - 1) >= 0xd800 &&
    value.charCodeAt(end - 1) <= 0xdbff &&
    value.charCodeAt(end) >= 0xdc00 &&
    value.charCodeAt(end) <= 0xdfff
  ) {
    end -= 1;
  }
  state.value += value.slice(0, end);
  state.truncated = true;
}

async function readTextFile(
  filePath: string,
  context: TextReadContext,
  offset: number,
  limit: number,
) {
  const output: OutputState = { lines: [], bytes: 0 };
  const line: { value: string; truncated: boolean } = { value: "", truncated: false };
  let totalLines = 0;
  let lastLine = offset - 1;
  let hasMore = false;
  let byteCapped = false;
  let lineCapped = false;
  let skipLeadingLineFeed = false;
  let stopped = false;
  const stream = fs.createReadStream(filePath);
  const decoder = new StringDecoder("utf8");
  let aborted = false;
  const abort = () => {
    aborted = true;
    stream.destroy();
  };
  context.abort?.addEventListener("abort", abort, { once: true });

  const finishLine = () => {
    totalLines += 1;
    if (totalLines < offset) {
      line.value = "";
      line.truncated = false;
      return true;
    }
    if (output.lines.length >= limit) {
      hasMore = true;
      return false;
    }
    const suffix = line.truncated ? " ... [line truncated]" : "";
    const rendered = `${totalLines}: ${line.value}${suffix}`;
    if (!appendOutputLine(output, rendered)) {
      hasMore = true;
      byteCapped = true;
      return false;
    }
    lastLine = totalLines;
    lineCapped ||= line.truncated;
    line.value = "";
    line.truncated = false;
    return true;
  };

  const consume = (text: string) => {
    let cursor = 0;
    if (skipLeadingLineFeed) {
      skipLeadingLineFeed = false;
      if (text.startsWith("\n")) cursor = 1;
    }
    while (cursor < text.length) {
      const newline = text.slice(cursor).search(/[\r\n]/);
      if (newline === -1) {
        appendLineSegment(text.slice(cursor), line);
        return true;
      }
      const end = cursor + newline;
      appendLineSegment(text.slice(cursor, end), line);
      const character = text[end];
      cursor = end + 1;
      if (character === "\r") {
        if (text[cursor] === "\n") cursor += 1;
        else if (cursor === text.length) skipLeadingLineFeed = true;
      }
      if (!finishLine()) return false;
    }
    return true;
  };

  try {
    if (context.abort?.aborted) abort();
    for await (const chunk of stream) {
      if (aborted || !consume(decoder.write(chunk))) {
        stopped = true;
        stream.destroy();
        break;
      }
    }
    if (aborted) throw new Error("Text read cancelled.");
    if (!stopped && !consume(decoder.end())) stopped = true;
    if (!stopped && line.value) finishLine();
  } finally {
    context.abort?.removeEventListener("abort", abort);
  }

  return textOutput(output, {
    offset,
    lastLine,
    hasMore,
    byteCapped,
    lineCapped,
    totalLines,
  });
}

function readableEntryName(name: string) {
  return name.replaceAll("\\", "\\\\").replaceAll("\r", "\\r").replaceAll("\n", "\\n");
}

function readDirectory(directoryPath: string, offset: number, limit: number) {
  const entries: string[] = [];
  let bounded = false;
  const directory = fs.opendirSync(directoryPath);
  try {
    for (;;) {
      const entry = directory.readSync();
      if (!entry) break;
      if (entries.length >= MAX_DIRECTORY_SCAN_ENTRIES) {
        bounded = true;
        break;
      }
      entries.push(`${readableEntryName(entry.name)}${entry.isDirectory() ? "/" : ""}`);
    }
  } finally {
    directory.closeSync();
  }
  entries.sort((left, right) => left.localeCompare(right));
  if (bounded && offset > 1) {
    return `Directory scan capped at ${MAX_DIRECTORY_SCAN_ENTRIES} entries. Use Glob with a narrower path.`;
  }

  const output: OutputState = { lines: [], bytes: 0 };
  const start = offset - 1;
  let lastEntry = offset - 1;
  let byteCapped = false;
  for (let index = start; index < entries.length && output.lines.length < limit; index += 1) {
    if (!appendOutputLine(output, `${index + 1}: ${entries[index]}`)) {
      byteCapped = true;
      break;
    }
    lastEntry = index + 1;
  }
  const hasMore = byteCapped || start + output.lines.length < entries.length;
  return directoryOutput(output, {
    offset,
    lastEntry,
    hasMore,
    byteCapped,
    totalEntries: entries.length,
    bounded,
  });
}

export async function executeTextRead(input: TextReadArgs, context: TextReadContext) {
  const args = normalizedArgs(input);
  if (!args.filePath) return "A filePath is required.";

  const requestedPath = resolvePath(args.filePath, context.directory);
  let accessPath = requestedPath;
  let stat: fs.Stats | undefined;
  try {
    accessPath = fs.realpathSync(requestedPath);
    stat = fs.statSync(accessPath);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
  }

  const kind = stat?.isDirectory() ? "directory" : "file";
  await requestReadPermission(
    context,
    requestedPath,
    accessPath,
    kind,
    args.offset,
    args.limit,
  );

  if (!stat) return `Path does not exist: ${displayPath(requestedPath, context.directory)}`;
  if (stat.isDirectory()) return readDirectory(accessPath, args.offset, args.limit);
  if (!stat.isFile()) {
    return `TextRead cannot safely read this special file: ${displayPath(accessPath, context.directory)}`;
  }

  const sample = readSample(accessPath, stat.size);
  const media = sniffMedia(sample);
  if (media) {
    return `Use native Read for ${media} attachments: ${displayPath(accessPath, context.directory)}`;
  }
  if (isLikelyBinary(sample, stat.size <= SAMPLE_BYTES)) {
    return `Use native Read for non-text content: ${displayPath(accessPath, context.directory)}`;
  }
  return readTextFile(accessPath, context, args.offset, args.limit);
}
