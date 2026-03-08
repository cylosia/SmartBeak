function normalizeBaseUrl(url: string): string {
	try {
		return new URL(url).toString().replace(/\/$/, "");
	} catch {
		throw new Error(`Invalid base URL: ${url}`);
	}
}

export function getBaseUrl() {
	if (process.env.NEXT_PUBLIC_SITE_URL) {
		return normalizeBaseUrl(process.env.NEXT_PUBLIC_SITE_URL);
	}
	if (process.env.NEXT_PUBLIC_VERCEL_URL) {
		return normalizeBaseUrl(`https://${process.env.NEXT_PUBLIC_VERCEL_URL}`);
	}
	return normalizeBaseUrl(`http://localhost:${process.env.PORT ?? 3000}`);
}
