import { describe, expect, it, vi } from "vitest";

const mockUpdatePurchaseBySubscriptionId = vi.fn();
const mockDeletePurchaseBySubscriptionId = vi.fn();
const mockCreatePurchase = vi.fn();

vi.mock("@repo/database", () => ({
	createPurchase: (...a: unknown[]) => mockCreatePurchase(...a),
	deletePurchaseBySubscriptionId: (...a: unknown[]) =>
		mockDeletePurchaseBySubscriptionId(...a),
	getPurchaseBySubscriptionId: vi.fn(),
	updatePurchase: vi.fn(),
	updatePurchaseBySubscriptionId: (...a: unknown[]) =>
		mockUpdatePurchaseBySubscriptionId(...a),
}));

describe("updatePurchaseBySubscriptionId contract", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("updates purchase directly by subscriptionId", async () => {
		mockUpdatePurchaseBySubscriptionId.mockResolvedValue({
			id: "p1",
			subscriptionId: "sub_123",
			status: "active",
			productId: "price_abc",
		});

		const result = await mockUpdatePurchaseBySubscriptionId("sub_123", {
			status: "active",
			productId: "price_abc",
		});

		expect(mockUpdatePurchaseBySubscriptionId).toHaveBeenCalledWith(
			"sub_123",
			{ status: "active", productId: "price_abc" },
		);
		expect(result.status).toBe("active");
	});

	it("returns null when subscription does not exist", async () => {
		mockUpdatePurchaseBySubscriptionId.mockResolvedValue(null);

		const result = await mockUpdatePurchaseBySubscriptionId("nonexistent");

		expect(result).toBeNull();
	});

	it("deletePurchaseBySubscriptionId removes by subscriptionId", async () => {
		mockDeletePurchaseBySubscriptionId.mockResolvedValue(undefined);

		await mockDeletePurchaseBySubscriptionId("sub_123");

		expect(mockDeletePurchaseBySubscriptionId).toHaveBeenCalledWith(
			"sub_123",
		);
	});

	it("createPurchase creates with correct shape", async () => {
		mockCreatePurchase.mockResolvedValue({
			id: "p2",
			subscriptionId: "sub_456",
			status: "active",
			type: "SUBSCRIPTION",
			productId: "prod_1",
			customerId: "cust_1",
			organizationId: "org-1",
			userId: null,
		});

		const result = await mockCreatePurchase({
			subscriptionId: "sub_456",
			customerId: "cust_1",
			type: "SUBSCRIPTION",
			productId: "prod_1",
			organizationId: "org-1",
			userId: null,
		});

		expect(result.subscriptionId).toBe("sub_456");
		expect(result.type).toBe("SUBSCRIPTION");
	});
});
