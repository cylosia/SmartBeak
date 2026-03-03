import { streamToEventIterator } from "@orpc/client";
import { streamText, textModel } from "@repo/ai";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";

export const generateContentIdeas = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/ai/ideas",
    tags: ["SmartBeak - AI"],
    summary: "Generate AI content ideas for a domain",
    description:
      "Uses the Vercel AI SDK to stream content idea suggestions based on domain context.",
  })
  .input(
    z.object({
      domainName: z.string().min(1).max(255),
      niche: z.string().min(1).max(255).optional(),
      count: z.number().int().min(1).max(20).default(5),
    }),
  )
  .handler(async ({ input }) => {
    const { domainName, niche, count } = input;
    const prompt = `You are a premium content strategist for a SaaS publishing platform.
Generate ${count} high-quality, SEO-optimized content ideas for a website called "${domainName}"${niche ? ` in the "${niche}" niche` : ""}.

For each idea, provide:
1. A compelling title (under 70 characters)
2. A one-sentence meta description
3. 3 target keywords
4. Estimated content type (article, listicle, guide, case study, etc.)

Format each idea as a numbered list. Be specific, actionable, and commercially valuable.`;

    const response = streamText({
      model: textModel,
      messages: [{ role: "user", content: prompt }],
      maxTokens: 1500,
    });
    return streamToEventIterator(response.toUIMessageStream());
  });
