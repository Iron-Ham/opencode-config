/**
 * Terminal detection utilities.
 *
 * Provides functions to detect the current terminal environment,
 * particularly useful for choosing terminal-specific behaviors.
 *
 * @module kdco-primitives/terminal-detect
 */

/** Check if the current process is running inside a tmux session. */
export function isInsideTmux(): boolean {
	// The TMUX environment variable contains socket info; only its presence matters.
	return !!process.env.TMUX
}
