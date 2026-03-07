import { describe, expect, it, vi } from "vitest";

const mockResolveSmartBeakOrg = vi.fn();
const mockRequireOrgAdmin = vi.fn();
const mockGetDomainById = vi.fn();
const mockUpdateDomain = vi.fn();
const mockGetSiteShardsForDomain = vi.fn();
const mockCreateSiteShard = vi.fn();
const mockAudit = vi.fn();

vi.mock("@repo/database", () => ({
	db: {},
	getDomainById: (...a: unknown[]) => mockGetDomainById(...a),
	updateDomain: (...a: unknown[]) => mockUpdateDomain(...a),
	getSiteShardsForDomain: (...a: unknown[]) =>
		mockGetSiteShardsForDomain(...a),
	createSiteShard: (...a: unknown[]) => mockCreateSiteShard(...a),
	updateSiteShard: vi.fn(),
	getSmartBeakOrgBySupastarterOrgId: vi.fn(),
	getOrganizationMembership: vi.fn(),
}));

vi.mock("@repo/logs", () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
	startSpan: vi.fn(() => ({
		traceId: "t",
		spanId: "s",
		operation: "test",
		attributes: {},
		startTime: 0,
	})),
	endSpan: vi.fn(),
	withSpan: vi.fn(),
}));

vi.mock("@repo/utils", () => ({
	fetchWithTimeout: vi.fn(),
	getBaseUrl: () => "http://localhost:3000",
}));

vi.mock("../../modules/smartbeak/lib/resolve-org", () => ({
	resolveSmartBeakOrg: (...a: unknown[]) => mockResolveSmartBeakOrg(...a),
}));

vi.mock("../../modules/smartbeak/lib/membership", () => ({
	requireOrgAdmin: (...a: unknown[]) => mockRequireOrgAdmin(...a),
}));

vi.mock("../../modules/smartbeak/lib/audit", () => ({
	audit: (...a: unknown[]) => mockAudit(...a),
}));

vi.mock("../../modules/smartbeak/deploy/lib/themes", () => ({
	generateThemeHtml: () => "<html></html>",
	THEME_IDS: ["landing-leadgen"] as const,
}));

import { triggerDeploy } from "../../modules/smartbeak/deploy/procedures/trigger-deploy";

const fakeOrg = { id: "org-1", supastarterOrgId: "sup-1" };
const fakeContext = {
	headers: new Headers(),
	session: { id: "s", userId: "u" },
	user: { id: "u", name: "Test", email: "t@t.com" },
};

describe("triggerDeploy — integration", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockResolveSmartBeakOrg.mockResolvedValue(fakeOrg);
		mockRequireOrgAdmin.mockResolvedValue(true);
		process.env.VERCEL_TOKEN = "test-token";
	});

	afterEach(() => {
		delete process.env.VERCEL_TOKEN;
	});

	it("rejects when domain is not found", async () => {
		mockGetDomainById.mockResolvedValue(null);

		const handler = triggerDeploy["~orpc"].handler;
		await expect(
			handler({
				input: {
					organizationSlug: "test-org",
					domainId: "00000000-0000-0000-0000-000000000001",
				},
				context: fakeContext,
			}),
		).rejects.toThrow("Domain not found");
	});

	it("rejects when domain belongs to a different org", async () => {
		mockGetDomainById.mockResolvedValue({
			id: "d1",
			orgId: "other-org",
			status: "active",
		});

		const handler = triggerDeploy["~orpc"].handler;
		await expect(
			handler({
				input: {
					organizationSlug: "test-org",
					domainId: "00000000-0000-0000-0000-000000000001",
				},
				context: fakeContext,
			}),
		).rejects.toThrow("Domain not found");
	});

	it("rejects when deploy is already in progress", async () => {
		mockGetDomainById.mockResolvedValue({
			id: "d1",
			orgId: "org-1",
			status: "pending",
		});

		const handler = triggerDeploy["~orpc"].handler;
		await expect(
			handler({
				input: {
					organizationSlug: "test-org",
					domainId: "00000000-0000-0000-0000-000000000001",
				},
				context: fakeContext,
			}),
		).rejects.toThrow("already in progress");
	});

	it("rejects on CAS failure (concurrent deploy race)", async () => {
		mockGetDomainById.mockResolvedValue({
			id: "d1",
			orgId: "org-1",
			status: "active",
		});
		mockUpdateDomain.mockResolvedValue([]);

		const handler = triggerDeploy["~orpc"].handler;
		await expect(
			handler({
				input: {
					organizationSlug: "test-org",
					domainId: "00000000-0000-0000-0000-000000000001",
				},
				context: fakeContext,
			}),
		).rejects.toThrow("already in progress");
	});
});
