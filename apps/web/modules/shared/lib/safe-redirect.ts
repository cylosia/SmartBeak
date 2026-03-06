const SAFE_PATH_REGEX = /^\/[a-zA-Z0-9\-._~:/?#[\]@!$&'()*+,;=%]*$/;

/**
 * Validates that a redirect path is a relative, same-origin path.
 * Rejects absolute URLs, protocol-relative URLs, and other open-redirect vectors.
 */
export function safeRedirectPath(
	path: string | null | undefined,
	fallback: string,
): string {
	if (!path) {
		return fallback;
	}

	if (!path.startsWith("/") || path.startsWith("//")) {
		return fallback;
	}

	try {
		const url = new URL(path, "http://localhost");
		if (url.origin !== "http://localhost") {
			return fallback;
		}
	} catch {
		return fallback;
	}

	if (!SAFE_PATH_REGEX.test(path)) {
		return fallback;
	}

	return path;
}
