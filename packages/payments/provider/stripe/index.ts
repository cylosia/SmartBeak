import {
	createPurchaseWithCustomer,
	deletePurchaseBySubscriptionId,
	updatePurchaseBySubscriptionId,
} from "@repo/database";
import { endSpan, logger, startSpan } from "@repo/logs";
import Stripe from "stripe";
import { requireEnv } from "../../lib/env";
import { isWebhookDuplicate } from "../../lib/webhook-idempotency";
import type {
	CancelSubscription,
	CreateCheckoutLink,
	CreateCustomerPortalLink,
	SetSubscriptionSeats,
	WebhookHandler,
} from "../../types";

let stripeClient: Stripe | null = null;

export function getStripeClient() {
	if (stripeClient) {
		return stripeClient;
	}

	const stripeSecretKey = requireEnv("STRIPE_SECRET_KEY");

	stripeClient = new Stripe(stripeSecretKey);

	return stripeClient;
}

export const createCheckoutLink: CreateCheckoutLink = async (options) => {
	const stripeClient = getStripeClient();
	const {
		type,
		productId,
		redirectUrl,
		customerId,
		organizationId,
		userId,
		trialPeriodDays,
		seats,
		email,
	} = options;

	const metadata = {
		organization_id: organizationId || null,
		user_id: userId || null,
	};

	const response = await stripeClient.checkout.sessions.create({
		mode: type === "subscription" ? "subscription" : "payment",
		success_url: redirectUrl ?? "",
		line_items: [
			{
				quantity: seats ?? 1,
				price: productId,
			},
		],
		...(customerId ? { customer: customerId } : { customer_email: email }),
		...(type === "one-time"
			? {
					payment_intent_data: {
						metadata,
					},
					customer_creation: "always",
				}
			: {
					subscription_data: {
						metadata,
						trial_period_days: trialPeriodDays,
					},
				}),
		metadata,
	});

	return response.url;
};

export const createCustomerPortalLink: CreateCustomerPortalLink = async ({
	customerId,
	redirectUrl,
}) => {
	const stripeClient = getStripeClient();

	const response = await stripeClient.billingPortal.sessions.create({
		customer: customerId,
		return_url: redirectUrl ?? "",
	});

	return response.url;
};

export const setSubscriptionSeats: SetSubscriptionSeats = async ({
	id,
	seats,
}) => {
	const stripeClient = getStripeClient();

	const subscription = await stripeClient.subscriptions.retrieve(id);

	if (!subscription) {
		throw new Error("Subscription not found.");
	}

	const firstItem = subscription.items.data[0];
	if (!firstItem) {
		throw new Error("Subscription has no line items.");
	}

	await stripeClient.subscriptions.update(id, {
		items: [
			{
				id: firstItem.id,
				quantity: seats,
			},
		],
	});
};

export const cancelSubscription: CancelSubscription = async (id) => {
	const stripeClient = getStripeClient();

	await stripeClient.subscriptions.cancel(id);
};

export const webhookHandler: WebhookHandler = async (req) => {
	const stripeClient = getStripeClient();

	if (!req.body) {
		return new Response("Invalid request.", {
			status: 400,
		});
	}

	const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
	if (!webhookSecret) {
		logger.error("[stripe] STRIPE_WEBHOOK_SECRET is not configured");
		return new Response("Internal server error.", { status: 500 });
	}

	const signatureHeader = req.headers.get("stripe-signature");
	if (!signatureHeader) {
		return new Response("Missing stripe-signature header.", {
			status: 400,
		});
	}

	let event: Stripe.Event | undefined;

	try {
		event = await stripeClient.webhooks.constructEventAsync(
			await req.text(),
			signatureHeader,
			webhookSecret,
		);
	} catch (e) {
		logger.error(e);

		return new Response("Invalid request.", {
			status: 400,
		});
	}

	if (await isWebhookDuplicate("stripe", event.id)) {
		return new Response(null, { status: 204 });
	}

	const span = startSpan("stripe.webhook", {
		eventType: event.type,
		eventId: event.id,
	});

	try {
		switch (event.type) {
			case "checkout.session.completed": {
				const { mode, metadata, customer, id } = event.data.object;

				if (mode === "subscription") {
					break;
				}

				const checkoutSession =
					await stripeClient.checkout.sessions.retrieve(id, {
						expand: ["line_items"],
					});

				const productId =
					checkoutSession.line_items?.data[0]?.price?.id;

				if (!productId) {
					return new Response("Missing product ID.", {
						status: 400,
					});
				}

				const custIdOneTime =
					typeof customer === "string"
						? customer
						: (customer?.id ?? "");

				await createPurchaseWithCustomer(
					{
						organizationId: metadata?.organization_id || null,
						userId: metadata?.user_id || null,
						customerId: custIdOneTime || null,
						type: "ONE_TIME",
						productId,
					},
					{
						customerId: custIdOneTime,
						organizationId: metadata?.organization_id,
						userId: metadata?.user_id,
					},
				);

				break;
			}
			case "customer.subscription.created": {
				const { metadata, customer, items, id } = event.data.object;

				const productId = items?.data[0]?.price?.id;

				if (!productId) {
					return new Response("Missing product ID.", {
						status: 400,
					});
				}

				const custId =
					typeof customer === "string"
						? customer
						: (customer?.id ?? null);

				await createPurchaseWithCustomer(
					{
						subscriptionId: id,
						organizationId: metadata?.organization_id || null,
						userId: metadata?.user_id || null,
						customerId: custId,
						type: "SUBSCRIPTION",
						productId,
						status: event.data.object.status,
					},
					{
						customerId: custId ?? "",
						organizationId: metadata?.organization_id,
						userId: metadata?.user_id,
					},
				);

				break;
			}
			case "customer.subscription.updated": {
				const subscriptionId = event.data.object.id;
				const updatedProductId =
					event.data.object.items?.data[0]?.price?.id;
				const newStatus = event.data.object.status;

				logger.info("[stripe] Subscription status transition", {
					subscriptionId,
					status: newStatus,
					eventType: event.type,
				});

				await updatePurchaseBySubscriptionId(subscriptionId, {
					status: newStatus,
					...(updatedProductId
						? { productId: updatedProductId }
						: {}),
				});

				break;
			}
			case "customer.subscription.deleted": {
				logger.info("[stripe] Subscription deleted", {
					subscriptionId: event.data.object.id,
					eventType: event.type,
				});

				await deletePurchaseBySubscriptionId(event.data.object.id);

				break;
			}

			default:
				return new Response("Unhandled event type.", {
					status: 200,
				});
		}

		endSpan(span, "ok");
		return new Response(null, { status: 204 });
	} catch (error) {
		endSpan(span, "error", {
			errorMessage:
				error instanceof Error ? error.message : String(error),
		});
		logger.error("[stripe] Webhook processing failed:", error);
		return new Response("Webhook processing failed.", {
			status: 400,
		});
	}
};
