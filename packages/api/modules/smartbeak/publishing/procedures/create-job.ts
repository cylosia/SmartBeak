import { ORPCError } from "@orpc/server";
import {
  createPublishingJob,
  getDomainById,
  getOrganizationBySlug,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";

const PUBLISH_TARGETS = [
  "web",
  "linkedin",
  "facebook",
  "instagram",
  "youtube",
  "wordpress",
  "email",
  "tiktok",
  "pinterest",
  "vimeo",
  "soundcloud",
] as const;

export const createPublishingJobProcedure = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/publishing/jobs",
    tags: ["SmartBeak - Publishing"],
    summary: "Create a publishing job",
  })
  .input(
    z.object({
      organizationSlug: z.string(),
      domainId: z.string().uuid(),
      contentId: z.string().uuid().optional(),
      target: z.enum(PUBLISH_TARGETS),
      scheduledFor: z.string().datetime().nullable().optional(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await getOrganizationBySlug(input.organizationSlug);
    if (!org) throw new ORPCError("NOT_FOUND", { message: "Organization not found." });
    await requireOrgEditor(org.id, user.id);
    const domain = await getDomainById(input.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }
    const [job] = await createPublishingJob({
      domainId: input.domainId,
      contentId: input.contentId,
      target: input.target,
      scheduledFor: input.scheduledFor ? new Date(input.scheduledFor) : undefined,
    });
    await audit({
      orgId: org.id,
      actorId: user.id,
      action: "publishing.job_created",
      entityType: "publishing_job",
      entityId: job?.id,
      details: { target: input.target, domainId: input.domainId },
    });
    return { job };
  });
