/**
 * Shared types for kdco registry plugins.
 *
 * @module kdco-primitives/types
 */

import type { createOpencodeClient } from "@opencode-ai/sdk"

/** OpenCode client instance type. */
export type OpencodeClient = ReturnType<typeof createOpencodeClient>
