import { generateText } from "@repo/ai";
import z from "zod";
import {
	checkAiBudget,
	recordAiSpend,
} from "../../../../infrastructure/ai-budget";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveTextModel } from "../../lib/resolve-ai";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

const ideaSchema = z.object({
	title: z.string().max(200),
	outline: z.string().max(1000),
	keywords: z.array(z.string().max(100)).max(10),
	contentType: z.string().max(50),
	estimatedReadTime: z.number(),
	seoScore: z.number(),
});
const ideasArraySchema = z.array(ideaSchema).max(25);
const ESTIMATED_IDEA_GENERATION_COST_CENTS = 2;

const SYSTEM_PROMPT = `You are a premium content strategist.
Return ONLY a JSON array (no markdown fences) where each object has:
- "title": string (compelling, under 70 chars)
- "outline": string (one-sentence summary/meta description)
- "keywords": string[] (exactly 3 target keywords)
- "contentType": string (article | listicle | guide | case-study | how-to)
- "estimatedReadTime": number (minutes, 3-15)
- "seoScore": number (estimated SEO potential 0-100)

Be specific, actionable, and commercially valuable.`;

export const generateContentIdeas = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/ai/ideas",
		tags: ["SmartBeak - AI"],
		summary: "Generate AI content ideas for a domain",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			domainName: z.string().min(1).max(255),
			niche: z.string().min(1).max(255).optional(),
			count: z.number().int().min(1).max(20).default(5),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);
		const { domainName, niche, count } = input;
		await checkAiBudget(org.id, ESTIMATED_IDEA_GENERATION_COST_CENTS);

		const model = await resolveTextModel(org.id);

		const response = await generateText({
			model,
			messages: [
				{ role: "system", content: SYSTEM_PROMPT },
				{
					role: "user",
					content: `Generate ${count} SEO-optimized content ideas.\nDomain: ${domainName}\nNiche: ${niche ?? "general"}`,
				},
			],
			maxOutputTokens: 2000,
		});

		try {
			const cleaned = response.text
				.replace(/```json?\s*/g, "")
				.replace(/```\s*/g, "")
				.trim();
			const parsed = ideasArraySchema.parse(JSON.parse(cleaned));
			recordAiSpend(org.id, ESTIMATED_IDEA_GENERATION_COST_CENTS).catch(
				() => {},
			);
			return { ideas: JSON.stringify(parsed), structured: parsed };
		} catch {
			recordAiSpend(org.id, ESTIMATED_IDEA_GENERATION_COST_CENTS).catch(
				() => {},
			);
			return { ideas: response.text, structured: [] };
		}
	});
