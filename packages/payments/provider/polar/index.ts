import { Polar } from "@polar-sh/sdk";
import {
	validateEvent,
	WebhookVerificationError,
} from "@polar-sh/sdk/webhooks.js";
import {
	createPurchaseWithCustomer,
	deletePurchaseBySubscriptionId,
	updatePurchaseBySubscriptionId,
} from "@repo/database";
import { logger } from "@repo/logs";
import { requireEnv } from "../../lib/env";
import { isWebhookDuplicate } from "../../lib/webhook-idempotency";
import type {
	CancelSubscription,
	CreateCheckoutLink,
	CreateCustomerPortalLink,
	SetSubscriptionSeats,
	WebhookHandler,
} from "../../types";

let polarClient: Polar;

function getPolarClient() {
	if (polarClient) {
		return polarClient;
	}

	const polarAccessToken = requireEnv("POLAR_ACCESS_TOKEN");

	polarClient = new Polar({
		accessToken: polarAccessToken,
		server:
			process.env.NODE_ENV === "production" ? "production" : "sandbox",
	});

	return polarClient;
}

export const createCheckoutLink: CreateCheckoutLink = async (options) => {
	const polarClient = getPolarClient();

	const { productId, redirectUrl, customerId, organizationId, userId } =
		options;

	const metadata: Record<string, string> = {};

	if (organizationId) {
		metadata.organization_id = organizationId;
	}

	if (userId) {
		metadata.user_id = userId;
	}

	const response = await polarClient.checkouts.create({
		products: [productId],
		successUrl: redirectUrl ?? "",
		metadata,
		customerId: customerId || undefined,
	});

	return response.url;
};

export const createCustomerPortalLink: CreateCustomerPortalLink = async ({
	customerId,
}) => {
	const polarClient = getPolarClient();

	const response = await polarClient.customerSessions.create({
		customerId: customerId,
	});

	return response.customerPortalUrl;
};

export const setSubscriptionSeats: SetSubscriptionSeats = async () => {
	throw new Error("Not implemented");
};

export const cancelSubscription: CancelSubscription = async (id) => {
	const polarClient = getPolarClient();

	await polarClient.subscriptions.revoke({
		id,
	});
};

export const webhookHandler: WebhookHandler = async (req) => {
	const polarWebhookSecret = process.env.POLAR_WEBHOOK_SECRET;
	if (!polarWebhookSecret) {
		logger.error("[polar] POLAR_WEBHOOK_SECRET is not configured");
		return new Response("Internal server error.", { status: 500 });
	}

	try {
		if (!req.body) {
			return new Response("No body", {
				status: 400,
			});
		}

		const rawBody = await req.text();
		const event = validateEvent(
			rawBody,
			Object.fromEntries(req.headers.entries()),
			polarWebhookSecret,
		);

		const polarEventId =
			req.headers.get("webhook-id") ?? `${event.type}:${Date.now()}`;
		if (await isWebhookDuplicate("polar", polarEventId)) {
			return new Response(null, { status: 204 });
		}

		switch (event.type) {
			case "order.created": {
				const { metadata, customerId, subscription, productId } =
					event.data;

				if (subscription) {
					break;
				}

				if (!productId) {
					return new Response("Missing product ID.", {
						status: 400,
					});
				}

				await createPurchaseWithCustomer(
					{
						organizationId:
							(metadata?.organization_id as string) || null,
						userId: (metadata?.user_id as string) || null,
						customerId,
						type: "ONE_TIME",
						productId,
					},
					{
						customerId,
						organizationId: metadata?.organization_id as string,
						userId: metadata?.user_id as string,
					},
				);

				break;
			}
			case "subscription.created": {
				const { metadata, customerId, productId, id, status } =
					event.data;

				await createPurchaseWithCustomer(
					{
						subscriptionId: id,
						organizationId: metadata?.organization_id as string,
						userId: metadata?.user_id as string,
						customerId,
						type: "SUBSCRIPTION",
						productId,
						status,
					},
					{
						customerId,
						organizationId: metadata?.organization_id as string,
						userId: metadata?.user_id as string,
					},
				);

				break;
			}
			case "subscription.updated": {
				const { id, status, productId } = event.data;

				logger.info("[polar] Subscription status transition", {
					subscriptionId: id,
					status,
					eventType: event.type,
				});

				await updatePurchaseBySubscriptionId(id, {
					status,
					productId,
				});

				break;
			}
			case "subscription.canceled": {
				const { id } = event.data;

				logger.info("[polar] Subscription canceled", {
					subscriptionId: id,
					eventType: event.type,
				});

				await deletePurchaseBySubscriptionId(id);

				break;
			}

			default:
				return new Response("Unhandled event type.", {
					status: 200,
				});
		}

		return new Response(null, {
			status: 202,
		});
	} catch (error) {
		if (error instanceof WebhookVerificationError) {
			return new Response("Invalid request.", {
				status: 403,
			});
		}
		logger.error("[polar] Webhook processing failed:", error);
		return new Response("Webhook processing failed.", {
			status: 400,
		});
	}
};
