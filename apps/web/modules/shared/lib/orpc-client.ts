import { createORPCClient, onError } from "@orpc/client";
import { RPCLink } from "@orpc/client/fetch";
import type { ApiRouterClient } from "@repo/api/orpc/router";
import { logger } from "@repo/logs";
import { getBaseUrl } from "@repo/utils";

const FORWARDED_SERVER_HEADERS = [
	"authorization",
	"cookie",
	"accept-language",
	"traceparent",
	"tracestate",
	"baggage",
	"x-request-id",
] as const;

async function getServerRpcHeaders() {
	const { headers } = await import("next/headers");
	const requestHeaders = await headers();

	return Object.fromEntries(
		FORWARDED_SERVER_HEADERS.flatMap((headerName) => {
			const headerValue = requestHeaders.get(headerName);
			return headerValue ? [[headerName, headerValue]] : [];
		}),
	);
}

const link = new RPCLink({
	url: `${getBaseUrl()}/api/rpc`,
	headers: async () => {
		if (typeof window !== "undefined") {
			return {};
		}

		return getServerRpcHeaders();
	},
	interceptors: [
		onError((error) => {
			if (error instanceof Error && error.name === "AbortError") {
				return;
			}

			logger.error("[oRPC]", error);
		}),
	],
});

export const orpcClient: ApiRouterClient = createORPCClient(link);
