"use client";

import { GoogleAnalytics, sendGAEvent } from "@next/third-parties/google";

const googleTagId = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID as string;

export function AnalyticsScript() {
	if (!googleTagId) {
		return null;
	}

	return <GoogleAnalytics gaId={googleTagId} />;
}

export function useAnalytics() {
	const trackEvent = (...args: Parameters<typeof sendGAEvent>) => {
		if (!googleTagId) {
			return;
		}

		sendGAEvent(...args);
	};

	return {
		trackEvent,
	};
}
