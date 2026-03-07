import { describe, expect, it, vi } from "vitest";

vi.mock("@repo/database", () => ({
	db: {},
	getSmartBeakOrgBySupastarterOrgId: vi.fn(),
	getOrganizationMembership: vi.fn(),
}));

vi.mock("@repo/logs", () => ({
	logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const mockResolveSmartBeakOrg = vi.fn();
vi.mock("../../modules/smartbeak/lib/resolve-org", () => ({
	resolveSmartBeakOrg: (...args: unknown[]) =>
		mockResolveSmartBeakOrg(...args),
}));

const mockRequireOrgMembership = vi.fn();
vi.mock("../../modules/smartbeak/lib/membership", () => ({
	requireOrgMembership: (...args: unknown[]) =>
		mockRequireOrgMembership(...args),
}));

const mockResolveTextModel = vi.fn();
vi.mock("../../modules/smartbeak/lib/resolve-ai", () => ({
	resolveTextModel: (...args: unknown[]) => mockResolveTextModel(...args),
}));

const mockGenerateText = vi.fn();
vi.mock("@repo/ai", () => ({
	generateText: (...args: unknown[]) => mockGenerateText(...args),
}));

import { generateContentIdeas } from "../../modules/smartbeak/ai-ideas/procedures/generate-ideas";

const VALID_AI_RESPONSE = JSON.stringify([
	{
		title: "10 Tips for Better SEO",
		outline: "A comprehensive guide to improving your search rankings.",
		keywords: ["seo", "ranking", "optimization"],
		contentType: "listicle",
		estimatedReadTime: 8,
		seoScore: 85,
	},
]);

describe("generateContentIdeas — integration", () => {
	const fakeOrg = { id: "org-1", supastarterOrgId: "sup-org-1" };

	beforeEach(() => {
		vi.clearAllMocks();
		mockResolveSmartBeakOrg.mockResolvedValue(fakeOrg);
		mockRequireOrgMembership.mockResolvedValue(true);
		mockResolveTextModel.mockResolvedValue("gpt-4o-mini");
		mockGenerateText.mockResolvedValue({ text: VALID_AI_RESPONSE });
	});

	it("returns structured ideas when AI returns valid JSON", async () => {
		const handler = generateContentIdeas["~orpc"].handler;
		const result = await handler({
			input: {
				organizationSlug: "test-org",
				domainName: "example.com",
				count: 1,
			},
			context: {
				headers: new Headers(),
				session: { id: "s", userId: "u" },
				user: { id: "u", name: "Test", email: "t@t.com" },
			},
		});

		expect(result.structured).toHaveLength(1);
		expect(result.structured[0]?.title).toBe("10 Tips for Better SEO");
		expect(result.structured[0]?.seoScore).toBe(85);
	});

	it("validates AI output and falls back on invalid JSON shape", async () => {
		mockGenerateText.mockResolvedValue({
			text: JSON.stringify([{ invalid: true }]),
		});

		const handler = generateContentIdeas["~orpc"].handler;
		const result = await handler({
			input: {
				organizationSlug: "test-org",
				domainName: "example.com",
				count: 1,
			},
			context: {
				headers: new Headers(),
				session: { id: "s", userId: "u" },
				user: { id: "u", name: "Test", email: "t@t.com" },
			},
		});

		expect(result.structured).toEqual([]);
		expect(result.ideas).toContain("invalid");
	});

	it("uses system/user message separation for prompt injection mitigation", async () => {
		const handler = generateContentIdeas["~orpc"].handler;
		await handler({
			input: {
				organizationSlug: "test-org",
				domainName: "example.com",
				niche: "tech",
				count: 3,
			},
			context: {
				headers: new Headers(),
				session: { id: "s", userId: "u" },
				user: { id: "u", name: "Test", email: "t@t.com" },
			},
		});

		const callArgs = mockGenerateText.mock.calls[0]?.[0];
		expect(callArgs.messages).toHaveLength(2);
		expect(callArgs.messages[0].role).toBe("system");
		expect(callArgs.messages[1].role).toBe("user");
		expect(callArgs.messages[1].content).toContain("example.com");
		expect(callArgs.messages[1].content).toContain("tech");
	});
});
