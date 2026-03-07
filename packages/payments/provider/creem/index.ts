import { createHmac, timingSafeEqual } from "node:crypto";
import {
	createPurchase,
	deletePurchaseBySubscriptionId,
	updatePurchaseBySubscriptionId,
} from "@repo/database";
import { logger } from "@repo/logs";
import { joinURL } from "ufo";
import type {
	CancelSubscription,
	CreateCheckoutLink,
	CreateCustomerPortalLink,
	SetSubscriptionSeats,
	WebhookHandler,
} from "../../types";

export function creemFetch(path: string, init: Parameters<typeof fetch>[1]) {
	const creemApiKey = process.env.CREEM_API_KEY as string;

	if (!creemApiKey) {
		throw new Error("Missing env variable CREEM_API_KEY");
	}

	const baseUrl =
		process.env.NODE_ENV === "production"
			? "https://api.creem.io/v1"
			: "https://test-api.creem.io/v1";

	const requestUrl = joinURL(baseUrl, path);
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), 15_000);

	return fetch(requestUrl, {
		...init,
		signal: controller.signal,
		headers: {
			"x-api-key": creemApiKey,
			"Content-Type": "application/json",
		},
	}).finally(() => clearTimeout(timer));
}

export const createCheckoutLink: CreateCheckoutLink = async (options) => {
	const { productId, redirectUrl, organizationId, userId, seats, email } =
		options;

	const response = await creemFetch("/checkouts", {
		method: "POST",
		body: JSON.stringify({
			product_id: productId,
			units: seats ?? 1,
			success_url: redirectUrl ?? undefined,
			metadata: {
				organization_id: organizationId || null,
				user_id: userId || null,
			},
			customer: {
				email,
			},
		}),
	});

	if (!response.ok) {
		const errorBody = await response.text();
		logger.error("Failed to create checkout link", errorBody);
		throw new Error("Failed to create checkout link");
	}

	const { checkout_url } = (await response.json()) as {
		checkout_url: string;
	};

	return checkout_url;
};

export const createCustomerPortalLink: CreateCustomerPortalLink = async ({
	customerId,
}) => {
	const response = await creemFetch("/customers/billing", {
		method: "POST",
		body: JSON.stringify({
			customer_id: customerId,
		}),
	});

	if (!response.ok) {
		const errorBody = await response.text();
		logger.error("Failed to create customer portal link", errorBody);
		throw new Error("Failed to create customer portal link");
	}

	const { customer_portal_link } = (await response.json()) as {
		customer_portal_link: string;
	};

	return customer_portal_link;
};

export const setSubscriptionSeats: SetSubscriptionSeats = async ({
	id,
	seats,
}) => {
	const response = await creemFetch(`/subscriptions?subscription_id=${id}`, {
		method: "GET",
	});

	if (!response.ok) {
		const errorBody = await response.text();
		logger.error("Failed to get subscription", errorBody);
		throw new Error("Failed to get subscription");
	}

	const { items } = (await response.json()) as { items: { id: string }[] };

	const firstItem = items[0];
	if (!firstItem) {
		throw new Error("Subscription has no line items");
	}

	const updateResponse = await creemFetch(`/subscriptions/${id}`, {
		method: "POST",
		body: JSON.stringify({
			items: [
				{
					id: firstItem.id,
					quantity: seats,
				},
			],
		}),
	});

	if (!updateResponse.ok) {
		const errorBody = await updateResponse.text();
		logger.error("Failed to update subscription seats", errorBody);
		throw new Error("Failed to update subscription seats");
	}
};

export const cancelSubscription: CancelSubscription = async (id) => {
	const response = await creemFetch(`/subscriptions/${id}/cancel`, {
		method: "POST",
	});

	if (!response.ok) {
		const errorBody = await response.text();
		logger.error("Failed to cancel subscription", errorBody);
		throw new Error("Failed to cancel subscription");
	}
};

export const webhookHandler: WebhookHandler = async (req) => {
	if (req.method !== "POST") {
		return new Response("Method not allowed.", {
			status: 405,
		});
	}

	const signature = req.headers.get("creem-signature");

	if (!signature) {
		return new Response("Missing signature.", {
			status: 400,
		});
	}

	const secret = process.env.CREEM_WEBHOOK_SECRET as string;

	if (!secret) {
		return new Response("Internal server error.", {
			status: 500,
		});
	}

	const bodyText = await req.text();

	const computedSignature = createHmac("sha256", secret)
		.update(bodyText)
		.digest("hex");

	const computedBuf = Buffer.from(computedSignature, "hex");
	const signatureBuf = Buffer.from(signature, "hex");
	if (
		computedBuf.length !== signatureBuf.length ||
		!timingSafeEqual(computedBuf, signatureBuf)
	) {
		return new Response("Invalid signature.", {
			status: 400,
		});
	}

	let payload: Record<string, unknown>;
	try {
		payload = JSON.parse(bodyText);
	} catch {
		return new Response("Invalid JSON payload.", { status: 400 });
	}

	try {
		switch (payload.eventType) {
			case "checkout.completed": {
				const { product, metadata, object, customer } = payload.object;
				if (!product?.id) {
					return new Response("Missing product ID.", {
						status: 400,
					});
				}

				if (object === "subscription") {
					break;
				}

				await createPurchase({
					organizationId: metadata?.organization_id || null,
					userId: metadata?.user_id || null,
					customerId: customer as string,
					type: "ONE_TIME",
					productId: product.id,
				});

				break;
			}
			case "subscription.active": {
				const { id, customer, product, metadata } = payload.object;

				const updated = await updatePurchaseBySubscriptionId(id, {
					status: product.status,
					productId: product.id,
				});

				if (!updated) {
					await createPurchase({
						subscriptionId: id,
						customerId: customer.id,
						type: "SUBSCRIPTION",
						productId: product.id,
						organizationId: metadata?.organization_id || null,
						userId: metadata?.user_id || null,
					});
				}

				break;
			}
			case "subscription.canceled":
			case "subscription.expired": {
				const { id } = payload.object;
				await deletePurchaseBySubscriptionId(id);
				break;
			}
			default:
				return new Response("Unhandled event type.", {
					status: 200,
				});
		}
		return new Response(null, { status: 204 });
	} catch (error) {
		logger.error("Creem webhook processing error", error);
		return new Response("Webhook processing failed", {
			status: 400,
		});
	}
};
