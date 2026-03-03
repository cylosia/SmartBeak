import { ORPCError } from "@orpc/server";
import {
  getBuyerSessionsForDomain,
  getDecaySignalsForDomain,
  getDiligenceChecksForDomain,
  getDomainById,
  getOrganizationBySlug,
  getPortfolioSummaryForOrg,
  getTimelineEventsForDomain,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";

export const getPortfolioSummary = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/portfolio",
    tags: ["SmartBeak - Portfolio"],
    summary: "Get portfolio summary for an organization",
  })
  .input(z.object({ organizationSlug: z.string() }))
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgMembership(org.id, user.id);
    const summary = await getPortfolioSummaryForOrg(org.id);
    return { summary };
  });

export const getDomainDiligence = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/portfolio/diligence",
    tags: ["SmartBeak - Portfolio"],
    summary: "Get diligence checks, decay signals, timeline, and buyer sessions for a domain",
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
    const [diligenceChecks, decaySignals, timeline, buyerSessions] =
      await Promise.all([
        getDiligenceChecksForDomain(input.domainId),
        getDecaySignalsForDomain(input.domainId),
        getTimelineEventsForDomain(input.domainId),
        getBuyerSessionsForDomain(input.domainId),
      ]);
    return { domain, diligenceChecks, decaySignals, timeline, buyerSessions };
  });
