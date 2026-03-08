import { getOrganizationWithPurchasesAndMembersCount } from "@repo/database";
import { logger } from "@repo/logs";
import { setSubscriptionSeats } from "@repo/payments";

const INACTIVE_SUBSCRIPTION_STATUSES = new Set([
	"canceled",
	"cancelled",
	"expired",
	"unpaid",
	"past_due",
	"incomplete",
	"incomplete_expired",
	"paused",
]);

export async function updateSeatsInOrganizationSubscription(
	organizationId: string,
) {
	const organization =
		await getOrganizationWithPurchasesAndMembersCount(organizationId);

	if (!organization?.purchases.length) {
		return;
	}

	const activeSubscription = organization.purchases.find(
		(purchase) =>
			purchase.type === "SUBSCRIPTION" &&
			!INACTIVE_SUBSCRIPTION_STATUSES.has(purchase.status ?? "") &&
			Boolean(purchase.subscriptionId),
	);

	if (!activeSubscription?.subscriptionId) {
		return;
	}

	try {
		await setSubscriptionSeats({
			id: activeSubscription.subscriptionId,
			seats: organization.membersCount,
		});
	} catch (error) {
		logger.error("Could not update seats in organization subscription", {
			organizationId,
			error,
		});
	}
}
