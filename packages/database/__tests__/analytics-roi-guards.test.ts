import { describe, expect, it, vi } from "vitest";

vi.mock("../drizzle/client", () => {
	const findFirst = vi.fn().mockResolvedValue(null);
	const findMany = vi.fn().mockResolvedValue([]);
	return {
		db: {
			query: {
				portfolioSummaries: { findFirst },
				domains: { findMany },
			},
			select: vi.fn().mockReturnThis(),
			from: vi.fn().mockReturnThis(),
			where: vi.fn().mockReturnThis(),
			groupBy: vi.fn().mockReturnThis(),
		},
	};
});

describe("getPortfolioRoiForOrg — empty domain guard", () => {
	it("returns early-return shape when org has no domains", async () => {
		const { getPortfolioRoiForOrg } = await import(
			"../drizzle/queries/analytics-roi"
		);
		const result = await getPortfolioRoiForOrg("empty-org-id");

		expect(result).toEqual({
			summary: null,
			domains: [],
			totalValue: 0,
			avgRoi: 0,
			totalDomains: 0,
		});
	});

	it("does not attempt the ANY(ARRAY[]) query when no domains exist", async () => {
		const { db } = await import("../drizzle/client");
		const { getPortfolioRoiForOrg } = await import(
			"../drizzle/queries/analytics-roi"
		);

		await getPortfolioRoiForOrg("empty-org-id");

		expect(db.select).not.toHaveBeenCalled();
	});
});
