import { ORPCError } from "@orpc/server";
import { logger } from "@repo/logs";

/**
 * Global error handler middleware.
 *
 * Catches unhandled errors from downstream procedures and normalizes them:
 * - ORPCError instances pass through unchanged (they already carry proper codes).
 * - All other errors are logged and replaced with a generic INTERNAL_SERVER_ERROR
 *   to prevent leaking stack traces, table names, or connection details.
 */
export async function errorHandlerMiddleware({
	next,
}: {
	next: () => Promise<unknown>;
}) {
	try {
		return await next();
	} catch (error) {
		if (error instanceof ORPCError) {
			throw error;
		}
		logger.error("[error-handler] Unhandled procedure error:", error);
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "An unexpected error occurred.",
		});
	}
}
