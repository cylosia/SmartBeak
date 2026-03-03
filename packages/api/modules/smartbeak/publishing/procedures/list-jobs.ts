import { ORPCError } from "@orpc/server";
import {
  countPublishingJobsForDomain,
  getDomainById,
  getPublishAttemptsForJob,
  getPublishingJobsForDomain,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const listPublishingJobs = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/publishing/jobs",
    tags: ["SmartBeak - Publishing"],
    summary: "List publishing jobs for a domain",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      domainId: z.string().uuid(),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);
    const domain = await getDomainById(input.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }
    const [rawJobs, total] = await Promise.all([
      getPublishingJobsForDomain(input.domainId, {
        limit: input.limit,
        offset: input.offset,
      }),
      countPublishingJobsForDomain(input.domainId),
    ]);
    const items = await Promise.all(
      rawJobs.map(async (job) => {
        const attempts = await getPublishAttemptsForJob(job.id);
        return {
          ...job,
          attemptCount: attempts.length,
          maxAttempts: 3,
        };
      }),
    );
    return { items, total };
  });
