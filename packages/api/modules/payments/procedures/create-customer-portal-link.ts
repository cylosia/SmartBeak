import { ORPCError } from "@orpc/server";
import { getOrganizationMembership, getPurchaseById } from "@repo/database";
import { logger } from "@repo/logs";
import { createCustomerPortalLink as createCustomerPortalLinkFn } from "@repo/payments";
import { getBaseUrl } from "@repo/utils";
import { z } from "zod";
import { localeMiddleware } from "../../../orpc/middleware/locale-middleware";
import { protectedProcedure } from "../../../orpc/procedures";

export const createCustomerPortalLink = protectedProcedure
	.use(localeMiddleware)
	.route({
		method: "POST",
		path: "/payments/create-customer-portal-link",
		tags: ["Payments"],
		summary: "Create customer portal link",
		description:
			"Creates a customer portal link for the customer or team. If a purchase is provided, the link will be created for the customer of the purchase.",
	})
	.input(
		z.object({
			purchaseId: z.string().min(1).max(64),
			redirectUrl: z.string().url().optional(),
		}),
	)
	.handler(
		async ({ input: { purchaseId, redirectUrl }, context: { user } }) => {
			if (redirectUrl) {
				const allowed = new URL(getBaseUrl()).origin;
				const target = new URL(redirectUrl).origin;
				if (target !== allowed) {
					throw new ORPCError("BAD_REQUEST", { message: "redirectUrl must point to the same origin." });
				}
			}

			const purchase = await getPurchaseById(purchaseId);

			if (!purchase) {
				throw new ORPCError("NOT_FOUND", { message: "Purchase not found." });
			}

			if (purchase.organizationId) {
				const userOrganizationMembership =
					await getOrganizationMembership(
						purchase.organizationId,
						user.id,
					);
				if (userOrganizationMembership?.role !== "owner") {
					throw new ORPCError("FORBIDDEN");
				}
			} else if (purchase.userId) {
				if (purchase.userId !== user.id) {
					throw new ORPCError("FORBIDDEN");
				}
			} else {
				throw new ORPCError("FORBIDDEN", { message: "Purchase has no owner." });
			}

			try {
				const customerPortalLink = await createCustomerPortalLinkFn({
					subscriptionId: purchase.subscriptionId ?? undefined,
					customerId: purchase.customerId,
					redirectUrl,
				});

				if (!customerPortalLink) {
					throw new ORPCError("INTERNAL_SERVER_ERROR");
				}

				return { customerPortalLink };
			} catch (e) {
				logger.error("Could not create customer portal link", e);
				throw new ORPCError("INTERNAL_SERVER_ERROR");
			}
		},
	);
