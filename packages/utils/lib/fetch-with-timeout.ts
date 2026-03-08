/**
 * Wraps `fetch` with an AbortController timeout.
 * Falls back to 15 seconds if no timeout is specified.
 */
export async function fetchWithTimeout(
	input: string | URL | Request,
	init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
	const { timeoutMs = 15_000, signal: initSignal, ...fetchInit } = init ?? {};
	const requestSignal = input instanceof Request ? input.signal : undefined;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	const signals = [controller.signal, initSignal, requestSignal].filter(
		(signal): signal is AbortSignal => Boolean(signal),
	);

	try {
		return await fetch(input, {
			...fetchInit,
			signal:
				signals.length === 1 ? signals[0] : AbortSignal.any(signals),
		});
	} finally {
		clearTimeout(timer);
	}
}
