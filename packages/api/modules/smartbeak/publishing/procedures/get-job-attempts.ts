import { ORPCError } from "@orpc/server";
import {
  getDomainById,
  getPublishAttemptsForJob,
  getPublishingJobById,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const getJobAttempts = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/publishing/jobs/{jobId}/attempts",
    tags: ["SmartBeak - Publishing"],
    summary: "Get attempts for a publishing job",
  })
  .input(
    z.object({
      organizationSlug: z.string().min(1),
      jobId: z.string().uuid(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgMembership(org.supastarterOrgId, user.id);
    const job = await getPublishingJobById(input.jobId);
    if (!job) throw new ORPCError("NOT_FOUND", { message: "Job not found." });
    const domain = await getDomainById(job.domainId);
    if (!domain || domain.orgId !== org.id) throw new ORPCError("FORBIDDEN", { message: "Access denied." });
    const attempts = await getPublishAttemptsForJob(input.jobId);
    return { job, attempts };
  });
