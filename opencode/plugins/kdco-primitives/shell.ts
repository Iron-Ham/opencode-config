/**
 * Shell escaping utilities for cross-platform terminal commands.
 *
 * Provides safe escaping functions for Bash, Windows Batch, and AppleScript.
 * All functions validate input for forbidden characters before escaping.
 *
 * @module kdco-primitives/shell
 */

/**
 * Characters that cannot be safely escaped in any shell.
 * Null bytes (\x00) cannot be represented in C strings and must be rejected.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: Null byte detection is intentional for security
const SHELL_FORBIDDEN_CHARS = /[\x00]/

/**
 * Assert that a string is safe for shell escaping.
 *
 * Null bytes cannot be escaped in any shell and must be rejected outright.
 * This is the first line of defense before any escaping is attempted.
 *
 * @param value - String to validate
 * @param context - Description for error message (e.g., "Bash argument")
 * @throws {Error} if string contains forbidden characters
 *
 * @example
 * ```ts
 * assertShellSafe(userInput, "Bash argument")
 * // Throws: "Bash argument contains null bytes..."
 *
 * assertShellSafe(filePath, "Script path")
 * // Throws: "Script path contains null bytes..."
 * ```
 */
export function assertShellSafe(value: string, context: string): void {
	// Law 4: Fail Fast - reject invalid input immediately with clear message
	if (SHELL_FORBIDDEN_CHARS.test(value)) {
		throw new Error(
			`${context} contains null bytes which cannot be safely escaped for shell execution`,
		)
	}
}

/**
 * Escape a string for safe use in bash double-quoted strings.
 *
 * Handles all shell metacharacters including:
 * - Backslash (\), double quote ("), dollar ($), backtick (`)
 * - Exclamation mark (!) for history expansion
 * - Newlines and carriage returns (replaced with spaces)
 *
 * @param str - String to validate and escape
 * @returns Escaped string safe for bash double-quoted context
 * @throws {Error} if string contains null bytes
 */
export function escapeBash(str: string): string {
	assertShellSafe(str, "Bash argument")
	return str
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\$/g, "\\$")
		.replace(/`/g, "\\`")
		.replace(/!/g, "\\!")
		.replace(/\n/g, " ")
		.replace(/\r/g, " ")
}

/** Escape a string for safe use in AppleScript double-quoted strings. */
export function escapeAppleScript(str: string): string {
	assertShellSafe(str, "AppleScript argument")
	return str
		.replace(/\\/g, "\\\\")
		.replace(/"/g, '\\"')
		.replace(/\n/g, " ")
		.replace(/\r/g, " ")
}

/** Escape a string for safe use in Windows batch files. */
export function escapeBatch(str: string): string {
	assertShellSafe(str, "Batch argument")
	return str
		.replace(/%/g, "%%")
		.replace(/\^/g, "^^")
		.replace(/&/g, "^&")
		.replace(/</g, "^<")
		.replace(/>/g, "^>")
		.replace(/\|/g, "^|")
}
