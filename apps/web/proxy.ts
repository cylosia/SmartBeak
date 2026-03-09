import { routing } from "@i18n/routing";
import { getSessionCookie } from "better-auth/cookies";
import { NextRequest, NextResponse } from "next/server";
import createMiddleware from "next-intl/middleware";
import { withQuery } from "ufo";
import { config as appConfig } from "@/config";

const intlMiddleware = createMiddleware(routing);

function createSecurityState(req: NextRequest) {
	const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
	const requestHeaders = new Headers(req.headers);
	requestHeaders.set("x-nonce", nonce);

	const cspDirectives = [
		"default-src 'self'",
		`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
		"style-src 'self' 'unsafe-inline'",
		"img-src 'self' data: blob: https:",
		"font-src 'self' data:",
		"connect-src 'self' https://*.openai.com https://*.vercel.app https://*.stripe.com https://*.mixpanel.com https://*.posthog.com https://*.google-analytics.com https://*.plausible.io https://*.pirsch.io",
		"frame-ancestors 'none'",
		"object-src 'none'",
		"base-uri 'self'",
		"form-action 'self'",
		"worker-src 'self' blob:",
	].join("; ");

	return { cspDirectives, requestHeaders };
}

function withSecurityHeaders(
	response: NextResponse,
	cspDirectives: string,
) {
	response.headers.set("Content-Security-Policy", cspDirectives);

	return response;
}

export default async function proxy(req: NextRequest) {
	const { pathname, origin } = req.nextUrl;
	const { cspDirectives, requestHeaders } = createSecurityState(req);
	const localizedRequest = new NextRequest(req.url, {
		headers: requestHeaders,
	});

	const sessionCookie = getSessionCookie(req);

	if (pathname.startsWith("/app")) {
		const response = NextResponse.next({
			request: { headers: requestHeaders },
		});

		if (!appConfig.saas.enabled) {
			return withSecurityHeaders(
				NextResponse.redirect(new URL("/", origin)),
				cspDirectives,
			);
		}

		if (!sessionCookie) {
			return withSecurityHeaders(
				NextResponse.redirect(
					new URL(
						withQuery("/auth/login", {
							redirectTo: pathname,
						}),
						origin,
					),
				),
				cspDirectives,
			);
		}

		return withSecurityHeaders(response, cspDirectives);
	}

	if (pathname.startsWith("/auth")) {
		if (!appConfig.saas.enabled) {
			return withSecurityHeaders(
				NextResponse.redirect(new URL("/", origin)),
				cspDirectives,
			);
		}

		return withSecurityHeaders(
			NextResponse.next({
				request: { headers: requestHeaders },
			}),
			cspDirectives,
		);
	}

	const pathsWithoutLocale = [
		"/onboarding",
		"/new-organization",
		"/choose-plan",
		"/organization-invitation",
	];

	if (pathsWithoutLocale.some((path) => pathname.startsWith(path))) {
		return withSecurityHeaders(
			NextResponse.next({
				request: { headers: requestHeaders },
			}),
			cspDirectives,
		);
	}

	if (!appConfig.marketing.enabled) {
		return withSecurityHeaders(
			NextResponse.redirect(new URL("/app", origin)),
			cspDirectives,
		);
	}

	return withSecurityHeaders(intlMiddleware(localizedRequest), cspDirectives);
}

export const config = {
	matcher: [
		"/((?!api|image-proxy|images|fonts|_next/static|_next/image|favicon.ico|icon.png|sitemap.xml|robots.txt).*)",
	],
};
