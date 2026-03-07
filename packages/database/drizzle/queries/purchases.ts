import { eq } from "drizzle-orm";
import type { z } from "zod";
import { db } from "../client";
import { purchase } from "../schema/postgres";
import type { PurchaseInsertSchema, PurchaseUpdateSchema } from "../zod";

export async function getPurchasesByOrganizationId(organizationId: string) {
	return db.query.purchase.findMany({
		where: (purchase, { eq }) =>
			eq(purchase.organizationId, organizationId),
		limit: 100,
	});
}

export async function getPurchasesByUserId(userId: string) {
	return db.query.purchase.findMany({
		where: (purchase, { eq }) => eq(purchase.userId, userId),
		limit: 100,
	});
}

export async function getPurchaseById(id: string) {
	return db.query.purchase.findFirst({
		where: (purchase, { eq }) => eq(purchase.id, id),
	});
}

export async function getPurchaseBySubscriptionId(subscriptionId: string) {
	return db.query.purchase.findFirst({
		where: (purchase, { eq }) =>
			eq(purchase.subscriptionId, subscriptionId),
	});
}

export async function createPurchase(
	insertedPurchase: z.infer<typeof PurchaseInsertSchema>,
) {
	const [newPurchase] = await db
		.insert(purchase)
		.values(insertedPurchase)
		.returning();

	return newPurchase;
}

export async function updatePurchase(
	updatedPurchase: z.infer<typeof PurchaseUpdateSchema>,
) {
	if (!updatedPurchase.id) {
		throw new Error("updatePurchase requires an id");
	}
	const [updated] = await db
		.update(purchase)
		.set(updatedPurchase)
		.where(eq(purchase.id, updatedPurchase.id))
		.returning();

	return updated;
}

export async function updatePurchaseBySubscriptionId(
	subscriptionId: string,
	data: Omit<z.infer<typeof PurchaseUpdateSchema>, "id">,
) {
	const [updated] = await db
		.update(purchase)
		.set(data)
		.where(eq(purchase.subscriptionId, subscriptionId))
		.returning();

	return updated ?? null;
}

export async function deletePurchaseBySubscriptionId(subscriptionId: string) {
	await db
		.delete(purchase)
		.where(eq(purchase.subscriptionId, subscriptionId));
}
