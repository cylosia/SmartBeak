/**
 * Wraps `fetch` with an AbortController timeout.
 * Falls back to 15 seconds if no timeout is specified.
 */
export async function fetchWithTimeout(
	input: string | URL | Request,
	init?: RequestInit & { timeoutMs?: number },
): Promise<Response> {
	const { timeoutMs = 15_000, ...fetchInit } = init ?? {};

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);

	try {
		return await fetch(input, {
			...fetchInit,
			signal: controller.signal,
		});
	} finally {
		clearTimeout(timer);
	}
}
