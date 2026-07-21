import { tool } from "@opencode-ai/plugin";
import {
  DEFAULT_TEXT_READ_LIMIT,
  MAX_TEXT_READ_LIMIT,
  executeTextRead,
} from "../context-tools-lib/text-read";

export default tool({
  description: "Read text, code, structured data, or directory listings with bounded output. Use native Read for images, PDFs, binaries, or attachments.",
  args: {
    filePath: tool.schema.string().describe("Absolute or workspace-relative path to a text file or directory"),
    offset: tool.schema.number().int().positive().optional().describe("1-indexed line or directory-entry offset"),
    limit: tool.schema.number().int().positive().max(MAX_TEXT_READ_LIMIT).optional().describe(`Maximum lines or entries to return (default ${DEFAULT_TEXT_READ_LIMIT})`),
  },
  async execute(args, context) {
    return executeTextRead(args, context);
  },
});
