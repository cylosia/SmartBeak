import { ORPCError } from "@orpc/server";
import { getOrganizationById, getOrganizationMembership } from "@repo/database";
import { logger } from "@repo/logs";
import {
	createCheckoutLink as createCheckoutLinkFn,
	getCustomerIdFromEntity,
} from "@repo/payments";
import { config } from "@repo/payments/config";
import { getBaseUrl } from "@repo/utils";
import { z } from "zod";
import { localeMiddleware } from "../../../orpc/middleware/locale-middleware";
import { protectedProcedure } from "../../../orpc/procedures";

export const createCheckoutLink = protectedProcedure
	.use(localeMiddleware)
	.route({
		method: "POST",
		path: "/payments/create-checkout-link",
		tags: ["Payments"],
		summary: "Create checkout link",
		description:
			"Creates a checkout link for a one-time or subscription product",
	})
	.input(
		z.object({
			type: z.enum(["one-time", "subscription"]),
			productId: z.string().min(1),
			redirectUrl: z.string().url().optional(),
			organizationId: z.string().min(1).optional(),
		}),
	)
	.handler(
		async ({
			input: { productId, redirectUrl, type, organizationId },
			context: { user },
		}) => {
			if (redirectUrl) {
				const allowed = new URL(getBaseUrl()).origin;
				const target = new URL(redirectUrl).origin;
				if (target !== allowed) {
					throw new ORPCError("BAD_REQUEST", { message: "redirectUrl must point to the same origin." });
				}
			}

			if (organizationId) {
				const membership = await getOrganizationMembership(organizationId, user.id);
				if (!membership) {
					throw new ORPCError("FORBIDDEN", { message: "You are not a member of this organization." });
				}
			}

			const customerId = await getCustomerIdFromEntity(
				organizationId
					? {
							organizationId,
						}
					: {
							userId: user.id,
						},
			);

			const plans = config.plans;

			const plan = Object.entries(plans).find(
				([_planId, plan]) =>
					"prices" in plan &&
					plan.prices?.find((price) => price.productId === productId),
			);

			if (!plan) {
				throw new ORPCError("NOT_FOUND");
			}

			const [_, planDetails] = plan;

			const price =
				"prices" in planDetails &&
				planDetails.prices?.find(
					(price) => price.productId === productId,
				);
			const trialPeriodDays =
				price && "trialPeriodDays" in price
					? price.trialPeriodDays
					: undefined;

			const organization = organizationId
				? await getOrganizationById(organizationId)
				: undefined;

		if (organizationId && !organization) {
			throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
		}

			const seats =
				organization && price && "seatBased" in price && price.seatBased
					? organization.members.length
					: undefined;

		try {
			const checkoutLink = await createCheckoutLinkFn({
				type,
				productId,
				email: user.email,
				name: user.name ?? "",
				redirectUrl,
				...(organizationId
					? { organizationId }
					: { userId: user.id }),
				trialPeriodDays,
				seats,
				customerId: customerId ?? undefined,
			});

			if (!checkoutLink) {
				throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create checkout link." });
			}

			return { checkoutLink };
		} catch (e) {
			if (e instanceof ORPCError) throw e;
			logger.error(e);
			throw new ORPCError("INTERNAL_SERVER_ERROR", { message: "Failed to create checkout link." });
		}
		},
	);
