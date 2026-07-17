/**
 * Temp directory utilities.
 *
 * Provides a reliable temp directory path that resolves symlinks,
 * which is critical on macOS where os.tmpdir() returns a symlink.
 *
 * @module kdco-primitives/temp
 */

import * as fsSync from "node:fs"
import * as os from "node:os"

/** Get the real temp directory path, resolving symlinks. */
export function getTempDir(): string {
	return fsSync.realpathSync.native(os.tmpdir())
}
