import type { z } from "zod";
import { db } from "../client";
import type { PurchaseSchema } from "../zod";

export async function getPurchaseById(id: string) {
	return db.purchase.findUnique({
		where: { id },
	});
}

export async function getPurchasesByOrganizationId(organizationId: string) {
	return db.purchase.findMany({
		where: {
			organizationId,
		},
		take: 100,
	});
}

export async function getPurchasesByUserId(userId: string) {
	return db.purchase.findMany({
		where: {
			userId,
		},
		take: 100,
	});
}

export async function getPurchaseBySubscriptionId(subscriptionId: string) {
	return db.purchase.findFirst({
		where: {
			subscriptionId,
		},
	});
}

export async function createPurchase(
	purchase: Omit<
		z.infer<typeof PurchaseSchema>,
		"id" | "createdAt" | "updatedAt"
	>,
) {
	return db.purchase.create({
		data: purchase,
	});
}

export async function updatePurchase(
	purchase: Partial<
		Omit<z.infer<typeof PurchaseSchema>, "createdAt" | "updatedAt">
	> & { id: string },
) {
	return db.purchase.update({
		where: {
			id: purchase.id,
		},
		data: purchase,
	});
}

export async function updatePurchaseBySubscriptionId(
	subscriptionId: string,
	data: Partial<
		Omit<z.infer<typeof PurchaseSchema>, "createdAt" | "updatedAt" | "id">
	>,
) {
	return db.purchase.updateMany({
		where: { subscriptionId },
		data,
	});
}

export async function deletePurchaseBySubscriptionId(subscriptionId: string) {
	await db.purchase.deleteMany({
		where: {
			subscriptionId,
		},
	});
}

/**
 * Atomically creates a purchase AND sets the paymentsCustomerId on the
 * associated organization or user within a single database transaction.
 * If either operation fails, both are rolled back.
 */
export async function createPurchaseWithCustomer(
	purchase: Omit<
		z.infer<typeof PurchaseSchema>,
		"id" | "createdAt" | "updatedAt"
	>,
	customerBinding: {
		customerId: string;
		organizationId?: string | null;
		userId?: string | null;
	},
) {
	return db.$transaction(async (tx) => {
		const created = await tx.purchase.create({ data: purchase });

		if (customerBinding.customerId) {
			if (customerBinding.organizationId) {
				await tx.organization.update({
					where: { id: customerBinding.organizationId },
					data: {
						paymentsCustomerId: customerBinding.customerId,
					},
				});
			} else if (customerBinding.userId) {
				await tx.user.update({
					where: { id: customerBinding.userId },
					data: {
						paymentsCustomerId: customerBinding.customerId,
					},
				});
			}
		}

		return created;
	});
}
