import { ORPCError } from "@orpc/server";
import {
  getDomainById,
  getOrganizationBySlug,
  getPublishingJobsForDomain,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";

export const listPublishingJobs = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/publishing/jobs",
    tags: ["SmartBeak - Publishing"],
    summary: "List publishing jobs for a domain",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      domainId: z.string().uuid(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
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
    const jobs = await getPublishingJobsForDomain(input.domainId, {
      limit: input.limit,
      offset: input.offset,
    });
    return { jobs };
  });
