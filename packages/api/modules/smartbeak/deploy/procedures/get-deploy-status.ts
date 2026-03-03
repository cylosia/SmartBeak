import { ORPCError } from "@orpc/server";
import {
  getDomainById,
  getOrganizationBySlug,
  getSiteShardsForDomain,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";

export const getDeployStatus = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/deploy/status",
    tags: ["SmartBeak - Deploy"],
    summary: "Get deployment status and shard history for a domain",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      domainId: z.string().uuid(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org)
      throw new ORPCError("NOT_FOUND", {
        message: "Organization not found.",
      });
    await requireOrgMembership(org.id, user.id);

    const domain = await getDomainById(input.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", {
        message: "Domain not found.",
      });
    }

    const shards = await getSiteShardsForDomain(domain.id);
    const latest = shards[0] ?? null;

    return {
      domain: {
        id: domain.id,
        name: domain.name,
        deployedUrl: domain.deployedUrl,
        themeId: domain.themeId,
        status: domain.status,
      },
      latest,
      shards,
    };
  });
