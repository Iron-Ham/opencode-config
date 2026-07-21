import { randomUUID } from "node:crypto";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

const DEFAULT_MAX_LINES = 300;
const DEFAULT_MAX_BYTES = 16_384;

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeBounds(value) {
  return {
    maxLines: positiveInteger(value?.max_lines, DEFAULT_MAX_LINES),
    maxBytes: positiveInteger(value?.max_bytes, DEFAULT_MAX_BYTES),
  };
}

function toolOutputDirectory(environment = process.env) {
  const dataHome = environment.XDG_DATA_HOME?.trim() || path.join(homedir(), ".local", "share");
  return path.join(dataHome, "opencode", "tool-output");
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function truncateBytes(value, maxBytes) {
  if (byteLength(value) <= maxBytes) return value;
  let result = "";
  let used = 0;
  for (const character of value) {
    const characterBytes = byteLength(character);
    if (used + characterBytes > maxBytes) break;
    result += character;
    used += characterBytes;
  }
  return result;
}

function existingArtifactPath(output) {
  const match = /^Full output saved to:\s*(.+)$/m.exec(output);
  return match?.[1]?.trim() || null;
}

async function persistOutput(output, directory = toolOutputDirectory()) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  const filePath = path.join(directory, `managed-${randomUUID()}`);
  await writeFile(filePath, output, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return filePath;
}

function truncationNotice({ artifactPath, originalBytes, originalLines, maxBytes }) {
  const detailed = `[truncated ${originalLines} lines / ${originalBytes} bytes; full output: ${artifactPath ?? "unavailable"}]`;
  if (byteLength(detailed) <= maxBytes) return detailed;
  return truncateBytes("[truncated]", maxBytes);
}

function truncateOutput(output, bounds, artifactPath) {
  const originalBytes = byteLength(output);
  const lines = output.split("\n");
  const originalLines = lines.length;
  if (originalBytes <= bounds.maxBytes && originalLines <= bounds.maxLines) {
    return { output, truncated: false, originalBytes, originalLines };
  }

  const notice = truncationNotice({ artifactPath, originalBytes, originalLines, maxBytes: bounds.maxBytes });
  const contentLineLimit = Math.max(0, bounds.maxLines - 1);
  const content = lines.slice(0, contentLineLimit).join("\n");
  const contentBytes = Math.max(0, bounds.maxBytes - byteLength(notice) - (content ? 1 : 0));
  const preview = truncateBytes(content, contentBytes);
  return {
    output: preview ? `${preview}\n${notice}` : notice,
    truncated: true,
    originalBytes,
    originalLines,
  };
}

async function resolvedBounds(client, directory) {
  try {
    const response = await client.config.get({ query: { directory } });
    return normalizeBounds(response?.data?.tool_output ?? response?.tool_output);
  } catch {
    return normalizeBounds();
  }
}

async function createToolOutputContainment({ client, directory }) {
  const bounds = resolvedBounds(client, directory);
  return {
    async "tool.execute.after"(input, output) {
      if (input.tool !== "bash" || typeof output.output !== "string") return;
      const effectiveBounds = await bounds;
      if (byteLength(output.output) <= effectiveBounds.maxBytes && output.output.split("\n").length <= effectiveBounds.maxLines) return;

      let artifactPath = existingArtifactPath(output.output);
      if (!artifactPath) {
        try {
          artifactPath = await persistOutput(output.output);
        } catch {
          artifactPath = null;
        }
      }
      const result = truncateOutput(output.output, effectiveBounds, artifactPath);
      output.output = result.output;
      output.metadata = {
        ...output.metadata,
        managedToolOutput: {
          truncated: true,
          maxLines: effectiveBounds.maxLines,
          maxBytes: effectiveBounds.maxBytes,
          originalLines: result.originalLines,
          originalBytes: result.originalBytes,
        },
      };
    },
  };
}

export const testHelpers = {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  normalizeBounds,
  toolOutputDirectory,
  truncateBytes,
  truncateOutput,
  createToolOutputContainment,
};

export default {
  id: "claude-config-tool-output-containment",
  server: createToolOutputContainment,
};
