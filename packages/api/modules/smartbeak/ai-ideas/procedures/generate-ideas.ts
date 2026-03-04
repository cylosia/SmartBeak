import { generateText, textModel } from "@repo/ai";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
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
    const prompt = `You are a premium content strategist for a SaaS publishing platform.
Generate ${count} high-quality, SEO-optimized content ideas for a website called "${domainName}"${niche ? ` in the "${niche}" niche` : ""}.

For each idea, provide:
1. A compelling title (under 70 characters)
2. A one-sentence meta description
3. 3 target keywords
4. Estimated content type (article, listicle, guide, case study, etc.)

Format each idea as a numbered list. Be specific, actionable, and commercially valuable.`;

    const response = await generateText({
      model: textModel,
      messages: [{ role: "user", content: prompt }],
      maxOutputTokens: 1500,
    });
    return { ideas: response.text };
  });
