const SAFE_PATH_REGEX = /^\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]*$/;

function isSafeRedirectCandidate(path: string): boolean {
	if (!path.startsWith("/") || path.startsWith("//")) {
		return false;
	}

	try {
		const url = new URL(path, "http://localhost");
		if (url.origin !== "http://localhost") {
			return false;
		}
	} catch {
		return false;
	}

	return SAFE_PATH_REGEX.test(path);
}

/**
 * Validates that a redirect path is a relative, same-origin path.
 * Rejects absolute URLs, protocol-relative URLs, and other open-redirect vectors.
 */
export function safeRedirectPath(
	path: string | null | undefined,
	fallback: string,
): string {
	const safeFallback = isSafeRedirectCandidate(fallback) ? fallback : "/";

	if (!path) {
		return safeFallback;
	}

	if (!isSafeRedirectCandidate(path)) {
		return safeFallback;
	}

	return path;
}
