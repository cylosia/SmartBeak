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
	await db.purchase.delete({
		where: {
			subscriptionId,
		},
	});
}
