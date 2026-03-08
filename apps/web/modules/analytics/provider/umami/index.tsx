"use client";

import Script from "next/script";

const umamiTrackingId = process.env.NEXT_PUBLIC_UMAMI_TRACKING_ID as string;

export function AnalyticsScript() {
	if (!umamiTrackingId) {
		return null;
	}

	return (
		<Script
			async
			type="text/javascript"
			data-website-id={umamiTrackingId}
			src="https://analytics.eu.umami.is/script.js"
		/>
	);
}

declare global {
	interface Window {
		umami?: {
			track: (
				event: string,
				options?: { props?: Record<string, unknown> },
			) => void;
		};
	}
}

export function useAnalytics() {
	const trackEvent = (event: string, data?: Record<string, unknown>) => {
		if (typeof window === "undefined" || !window.umami) {
			return;
		}

		window.umami.track(event, {
			props: data,
		});
	};

	return {
		trackEvent,
	};
}
