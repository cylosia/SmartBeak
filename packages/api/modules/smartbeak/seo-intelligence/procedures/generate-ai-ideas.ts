import { ORPCError } from "@orpc/server";
import { generateObject, textModel } from "@repo/ai";
import {
  getDomainById,
  getKeywordsForDomain,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

const IdeaSchema = z.object({
  title: z.string().describe("Compelling SEO-optimized title under 70 characters"),
  metaDescription: z
    .string()
    .describe("One-sentence meta description under 160 characters"),
  outline: z
    .array(z.string())
    .describe("3-5 H2 section headings for the article"),
  targetKeywords: z
    .array(z.string())
    .describe("3 primary target keywords"),
  contentType: z
    .enum(["article", "listicle", "guide", "case-study", "comparison"])
    .describe("Best content format for this topic"),
  estimatedReadTime: z
    .number()
    .int()
    .describe("Estimated reading time in minutes"),
  seoScore: z
    .number()
    .int()
    .min(0)
    .max(100)
    .describe("Estimated SEO potential score 0-100"),
  difficulty: z
    .enum(["easy", "medium", "hard"])
    .describe("Content creation difficulty"),
});

const IdeasResponseSchema = z.object({
  ideas: z.array(IdeaSchema),
});

export const generateAiIdeas = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/seo-intelligence/ai/ideas",
    tags: ["SmartBeak - SEO Intelligence"],
    summary: "Generate AI content ideas with SEO scoring using Vercel AI SDK",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      domainId: z.string().uuid(),
      niche: z.string().max(255).optional(),
      targetKeywords: z.array(z.string().max(100)).max(10).optional(),
      contentType: z
        .enum(["article", "listicle", "guide", "case-study", "comparison", "any"])
        .default("any"),
      count: z.number().int().min(1).max(10).default(5),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);

    const domain = await getDomainById(input.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }

    // Pull existing tracked keywords to inform the AI
    const trackedKeywords = await getKeywordsForDomain(input.domainId);
    const topKeywords = trackedKeywords
      .slice(0, 10)
      .map((k) => k.keyword)
      .join(", ");

    const contentTypeInstruction =
      input.contentType === "any"
        ? "Choose the most appropriate content format for each idea."
        : `All ideas should be formatted as ${input.contentType}.`;

    const userKeywords =
      input.targetKeywords && input.targetKeywords.length > 0
        ? `\nUser-specified target keywords: ${input.targetKeywords.join(", ")}`
        : "";

    const trackedContext =
      topKeywords.length > 0
        ? `\nCurrently tracked keywords for this domain: ${topKeywords}`
        : "";

    const prompt = `You are a senior content strategist for a premium SaaS publishing platform.

Generate exactly ${input.count} high-value, SEO-optimized content ideas for the domain "${domain.name}"${input.niche ? ` in the "${input.niche}" niche` : ""}.
${contentTypeInstruction}
${userKeywords}
${trackedContext}

Requirements for each idea:
- Title must be under 70 characters and highly clickable
- Meta description must be under 160 characters
- Outline must have 3-5 specific, actionable H2 headings
- Target keywords must be realistic and commercially valuable
- SEO score should reflect keyword competition, search intent alignment, and content depth potential
- Difficulty should reflect how hard it is to rank for this topic

Focus on topics with high commercial intent, clear search demand, and realistic ranking potential.`;

    let result: z.infer<typeof IdeasResponseSchema>;
    try {
      const { object } = await generateObject({
        model: textModel,
        schema: IdeasResponseSchema,
        prompt,
      });
      result = object;
    } catch (err) {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: `AI generation failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    return {
      ideas: result.ideas,
      domainName: domain.name,
      generatedAt: new Date().toISOString(),
    };
  });
