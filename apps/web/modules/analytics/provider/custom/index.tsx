"use client";

export function AnalyticsScript() {
	// return your script here
	return null;
}

export function useAnalytics() {
	const trackEvent = (_event: string, _data: Record<string, unknown>) => {
		// call your analytics service to track a custom event here
	};

	return {
		trackEvent,
	};
}
