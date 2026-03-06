import { ORPCError } from "@orpc/server";
import { getDomainById, getSellReadyScore } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const getSellReadyScoreProc = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/analytics/sell-ready",
    tags: ["SmartBeak - Analytics"],
    summary: "Get sell-ready score with improvement recommendations for a domain",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      domainId: z.string().uuid(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);

    const domain = await getDomainById(input.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }

    const result = await getSellReadyScore(input.domainId);
    if (!result) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }
    return result;
  });
