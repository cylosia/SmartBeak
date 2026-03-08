"use client";

import Cookies from "js-cookie";
import { createContext, useState } from "react";

type ConsentState = "accepted" | "declined" | "unknown";

export const ConsentContext = createContext<{
	hasAnsweredConsent: boolean;
	userHasConsented: boolean;
	allowCookies: () => void;
	declineCookies: () => void;
}>({
	hasAnsweredConsent: false,
	userHasConsented: false,
	allowCookies: () => {},
	declineCookies: () => {},
});

export function ConsentProvider({
	children,
	initialConsentState,
}: {
	children: React.ReactNode;
	initialConsentState?: Exclude<ConsentState, "unknown">;
}) {
	const [consentState, setConsentState] = useState<ConsentState>(
		initialConsentState ?? "unknown",
	);

	const allowCookies = () => {
		Cookies.set("consent", "true", { expires: 30 });
		setConsentState("accepted");
	};

	const declineCookies = () => {
		Cookies.set("consent", "false", { expires: 30 });
		setConsentState("declined");
	};

	return (
		<ConsentContext.Provider
			value={{
				hasAnsweredConsent: consentState !== "unknown",
				userHasConsented: consentState === "accepted",
				allowCookies,
				declineCookies,
			}}
		>
			{children}
		</ConsentContext.Provider>
	);
}
