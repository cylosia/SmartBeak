import { ORPCError, os } from "@orpc/server";
import { auth } from "@repo/auth";
import { errorHandlerMiddleware } from "./middleware/error-handler-middleware";

export const publicProcedure = os
	.$context<{
		headers: Headers;
	}>()
	.use(errorHandlerMiddleware);

export const protectedProcedure = publicProcedure.use(
	async ({ context, next }) => {
		const session = await auth.api.getSession({
			headers: context.headers,
		});

		if (!session) {
			throw new ORPCError("UNAUTHORIZED");
		}

		return await next({
			context: {
				session: session.session,
				user: session.user,
			},
		});
	},
);

export const adminProcedure = protectedProcedure.use(
	async ({ context, next }) => {
		if ((context.user as { role?: string }).role !== "admin") {
			throw new ORPCError("FORBIDDEN");
		}

		return await next();
	},
);
