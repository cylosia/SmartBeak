import { ORPCError } from "@orpc/server";
import {
  getDomainById,
  getKeywordsForDomain,
  getOrganizationBySlug,
  getSeoDocumentForDomain,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";

export const getSeo = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/seo",
    tags: ["SmartBeak - SEO"],
    summary: "Get SEO document and keywords for a domain",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      domainId: z.string().uuid(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgMembership(org.id, user.id);
    const domain = await getDomainById(input.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }
    const [seoDoc, keywords] = await Promise.all([
      getSeoDocumentForDomain(input.domainId),
      getKeywordsForDomain(input.domainId),
    ]);
    return { seoDoc, keywords };
  });
