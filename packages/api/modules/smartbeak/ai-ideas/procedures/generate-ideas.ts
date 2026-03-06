import { generateText } from "@repo/ai";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveTextModel } from "../../lib/resolve-ai";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const generateContentIdeas = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/ai/ideas",
		tags: ["SmartBeak - AI"],
		summary: "Generate AI content ideas for a domain",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			domainName: z.string().min(1).max(255),
			niche: z.string().min(1).max(255).optional(),
			count: z.number().int().min(1).max(20).default(5),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);
		const { domainName, niche, count } = input;
		const prompt = `You are a premium content strategist. Generate ${count} SEO-optimized content ideas for "${domainName}"${niche ? ` in the "${niche}" niche` : ""}.

Return ONLY a JSON array (no markdown fences) where each object has:
- "title": string (compelling, under 70 chars)
- "outline": string (one-sentence summary/meta description)
- "keywords": string[] (exactly 3 target keywords)
- "contentType": string (article | listicle | guide | case-study | how-to)
- "estimatedReadTime": number (minutes, 3-15)
- "seoScore": number (estimated SEO potential 0-100)

Be specific, actionable, and commercially valuable.`;

		const model = await resolveTextModel(org.id);

		const response = await generateText({
			model,
			messages: [{ role: "user", content: prompt }],
			maxOutputTokens: 2000,
		});

		try {
			const cleaned = response.text
				.replace(/```json?\s*/g, "")
				.replace(/```\s*/g, "")
				.trim();
			const parsed = JSON.parse(cleaned) as Array<{
				title: string;
				outline: string;
				keywords: string[];
				contentType: string;
				estimatedReadTime: number;
				seoScore: number;
			}>;
			return { ideas: JSON.stringify(parsed), structured: parsed };
		} catch {
			return { ideas: response.text, structured: [] };
		}
	});
