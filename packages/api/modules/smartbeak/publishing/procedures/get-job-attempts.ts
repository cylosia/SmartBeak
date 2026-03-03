import { ORPCError } from "@orpc/server";
import {
  getDomainById,
  getOrganizationBySlug,
  getPublishAttemptsForJob,
  getPublishingJobById,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";

export const getJobAttempts = protectedProcedure
  .route({
    method: "GET",
    path: "/smartbeak/publishing/jobs/{jobId}/attempts",
    tags: ["SmartBeak - Publishing"],
    summary: "Get attempts for a publishing job",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      jobId: z.string().uuid(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgMembership(org.id, user.id);
    const job = await getPublishingJobById(input.jobId);
    if (!job) throw new ORPCError("NOT_FOUND", { message: "Job not found." });
    const domain = await getDomainById(job.domainId);
    if (!domain || domain.orgId !== org.id) throw new ORPCError("FORBIDDEN");
    const attempts = await getPublishAttemptsForJob(input.jobId);
    return { job, attempts };
  });
