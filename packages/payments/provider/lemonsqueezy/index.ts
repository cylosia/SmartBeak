import { createHmac, timingSafeEqual } from "node:crypto";
import {
	cancelSubscription as cancelSubscriptionResolver,
	createCheckout,
	getCustomer,
	getSubscription,
	lemonSqueezySetup,
	updateSubscriptionItem,
} from "@lemonsqueezy/lemonsqueezy.js";
import {
	createPurchaseWithCustomer,
	deletePurchaseBySubscriptionId,
	updatePurchaseBySubscriptionId,
} from "@repo/database";
import { logger } from "@repo/logs";
import { isWebhookDuplicate } from "../../lib/webhook-idempotency";
import type {
	CancelSubscription,
	CreateCheckoutLink,
	CreateCustomerPortalLink,
	SetSubscriptionSeats,
	WebhookHandler,
} from "../../types";

const MAX_WEBHOOK_BODY_BYTES = 256 * 1024;

async function readRequestTextWithLimit(
	req: Request,
	maxBytes: number,
): Promise<string> {
	const contentLength = req.headers.get("content-length");
	if (contentLength) {
		const parsedLength = Number.parseInt(contentLength, 10);
		if (Number.isFinite(parsedLength) && parsedLength > maxBytes) {
			throw new Error("Webhook payload too large");
		}
	}

	const reader = req.body?.getReader();
	if (!reader) {
		throw new Error("Invalid request body");
	}

	const decoder = new TextDecoder();
	let totalBytes = 0;
	let text = "";

	while (true) {
		const { done, value } = await reader.read();
		if (done) {
			break;
		}
		totalBytes += value.byteLength;
		if (totalBytes > maxBytes) {
			throw new Error("Webhook payload too large");
		}
		text += decoder.decode(value, { stream: true });
	}

	text += decoder.decode();
	return text;
}

function initLemonsqueezyApi() {
	if (!process.env.LEMONSQUEEZY_API_KEY) {
		throw new Error("Missing LEMONSQUEEZY_API_KEY environment variable");
	}
	lemonSqueezySetup({
		apiKey: process.env.LEMONSQUEEZY_API_KEY,
	});
}

export const createCheckoutLink: CreateCheckoutLink = async (options) => {
	initLemonsqueezyApi();

	const { seats, productId, redirectUrl, email, name } = options;

	if (!process.env.LEMONSQUEEZY_STORE_ID) {
		throw new Error("Missing LEMONSQUEEZY_STORE_ID environment variable");
	}

	const numericProductId = Number.parseInt(productId, 10);
	if (
		Number.isNaN(numericProductId) ||
		numericProductId > Number.MAX_SAFE_INTEGER ||
		numericProductId < 1
	) {
		throw new Error(`Invalid LemonSqueezy product ID: ${productId}`);
	}

	const response = await createCheckout(
		process.env.LEMONSQUEEZY_STORE_ID,
		productId,
		{
			productOptions: {
				redirectUrl,
				enabledVariants: [numericProductId],
			},
			checkoutData: {
				email,
				name,
				variantQuantities: [
					{
						variantId: numericProductId,
						quantity: seats ?? 1,
					},
				],
				custom:
					"organizationId" in options
						? {
								organization_id: options.organizationId,
							}
						: {
								user_id: options.userId,
							},
			},
		},
	);

	return response.data?.data.attributes.url ?? null;
};

export const createCustomerPortalLink: CreateCustomerPortalLink = async ({
	customerId,
}) => {
	initLemonsqueezyApi();

	const response = await getCustomer(customerId);

	return response.data?.data.attributes.urls.customer_portal ?? null;
};

export const setSubscriptionSeats: SetSubscriptionSeats = async ({
	id,
	seats,
}) => {
	initLemonsqueezyApi();

	const subscription = await getSubscription(id, {
		include: ["subscription-items"],
	});

	if (!subscription) {
		throw new Error("Subscription not found.");
	}

	const subscriptionItem =
		subscription.data?.data.relationships["subscription-items"].data?.[0];

	if (!subscriptionItem) {
		throw new Error("Subscription item not found.");
	}

	await updateSubscriptionItem(subscriptionItem.id, {
		quantity: seats,
	});
};

export const cancelSubscription: CancelSubscription = async (id) => {
	initLemonsqueezyApi();

	await cancelSubscriptionResolver(id);
};

export const webhookHandler: WebhookHandler = async (req: Request) => {
	try {
		const text = await readRequestTextWithLimit(
			req,
			MAX_WEBHOOK_BODY_BYTES,
		);
		const webhookSecret = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
		if (!webhookSecret) {
			return new Response("Internal server error.", { status: 500 });
		}
		const hmac = createHmac("sha256", webhookSecret);
		const digest = Buffer.from(hmac.update(text).digest("hex"), "hex");
		const signatureHeader = req.headers.get("x-signature");
		if (!signatureHeader) {
			return new Response("Missing signature header.", { status: 400 });
		}
		const signature = Buffer.from(signatureHeader, "hex");

		if (!timingSafeEqual(digest, signature)) {
			return new Response("Invalid signature.", {
				status: 400,
			});
		}

		let payload: {
			meta: {
				event_name: string;
				custom_data: {
					organization_id?: string;
					user_id?: string;
				};
			};
			data: {
				id: string;
				attributes: {
					customer_id: string;
					product_id: string;
					variant_id: string;
					status: string;
					trial_ends_at?: number;
					renews_at?: number;
				};
			};
		} | null;

		try {
			payload = JSON.parse(text);
		} catch {
			return new Response("Invalid JSON payload.", { status: 400 });
		}

		if (!payload) {
			return new Response("Invalid payload.", {
				status: 400,
			});
		}

		const {
			meta: { event_name: eventName, custom_data: customData },
			data,
		} = payload;

		const id = String(data.id);

		if (await isWebhookDuplicate("lemonsqueezy", `${eventName}:${id}`)) {
			return new Response(null, { status: 204 });
		}

		switch (eventName) {
			case "subscription_created": {
				await createPurchaseWithCustomer(
					{
						organizationId: customData.organization_id,
						userId: customData.user_id,
						subscriptionId: id,
						customerId: String(data.attributes.customer_id),
						productId: String(data.attributes.variant_id),
						status: data.attributes.status,
						type: "SUBSCRIPTION",
					},
					{
						customerId: String(data.attributes.customer_id),
						organizationId: customData.organization_id,
						userId: customData.user_id,
					},
				);

				break;
			}
			case "subscription_updated":
			case "subscription_cancelled":
			case "subscription_resumed": {
				const subscriptionId = String(data.id);

				logger.info("[lemonsqueezy] Subscription status transition", {
					subscriptionId,
					status: data.attributes.status,
					eventName,
				});

				await updatePurchaseBySubscriptionId(subscriptionId, {
					status: data.attributes.status,
				});

				break;
			}

			case "subscription_expired": {
				const subscriptionId = String(data.id);

				logger.info("[lemonsqueezy] Subscription expired", {
					subscriptionId,
					eventName,
				});

				await deletePurchaseBySubscriptionId(subscriptionId);

				break;
			}
			case "order_created": {
				await createPurchaseWithCustomer(
					{
						organizationId: customData.organization_id,
						userId: customData.user_id,
						customerId: String(data.attributes.customer_id),
						productId: String(data.attributes.product_id),
						type: "ONE_TIME",
					},
					{
						customerId: String(data.attributes.customer_id),
						organizationId: customData.organization_id,
						userId: customData.user_id,
					},
				);

				break;
			}

			default: {
				return new Response("Unhandled event type.", {
					status: 200,
				});
			}
		}

		return new Response(null, { status: 204 });
	} catch (error) {
		if (
			error instanceof Error &&
			error.message === "Webhook payload too large"
		) {
			return new Response("Payload too large.", { status: 413 });
		}
		logger.error("[lemonsqueezy] Webhook processing failed:", error);
		return new Response("Webhook processing failed.", {
			status: 400,
		});
	}
};
