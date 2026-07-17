/**
 * Promise timeout utility for kdco registry plugins.
 *
 * Provides a clean wrapper around Promise.race for timeout handling.
 *
 * @module kdco-primitives/with-timeout
 */

/** Error thrown when a promise times out. */
export class TimeoutError extends Error {
	readonly name = "TimeoutError" as const
	readonly timeoutMs: number

	constructor(message: string, timeoutMs: number) {
		super(message)
		this.timeoutMs = timeoutMs
	}
}

/** Wrap a promise with a timeout. */
export async function withTimeout<T>(
	promise: Promise<T>,
	ms: number,
	message = "Operation timed out",
): Promise<T> {
	if (typeof ms !== "number" || ms < 0) {
		throw new Error(`withTimeout: timeout must be a non-negative number, got ${ms}`)
	}

	if (ms === 0) {
		throw new TimeoutError(message, ms)
	}

	let timeoutId: Timer
	return Promise.race([
		promise.finally(() => clearTimeout(timeoutId)),
		new Promise<never>((_, reject) => {
			timeoutId = setTimeout(() => {
				reject(new TimeoutError(message, ms))
			}, ms)
		}),
	])
}
