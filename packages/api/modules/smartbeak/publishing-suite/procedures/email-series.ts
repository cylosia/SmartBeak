import { ORPCError } from "@orpc/server";
import {
  bulkCreatePublishingJobs,
  getDomainById,
} from "@repo/database";
import { emailSeriesInputSchema } from "@repo/database";
import { logger } from "@repo/logs";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

const RESEND_API = "https://api.resend.com";

export const createEmailSeriesProcedure = protectedProcedure
  .route({
    method: "POST",
    path: "/smartbeak/publishing-suite/email-series",
    tags: ["SmartBeak - Publishing Suite"],
    summary: "Create a drip email series using Resend automation",
  })
  .input(emailSeriesInputSchema)
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgEditor(org.supastarterOrgId, user.id);

    const domain = await getDomainById(input.domainId);
    if (!domain || domain.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new ORPCError("BAD_REQUEST", { message: "RESEND_API_KEY not configured." });
    }

    // Create Resend broadcast/audience if needed (stub — real impl uses Resend Audiences API)
    const startDate = input.startAt ? new Date(input.startAt) : new Date();

    // Schedule one publishing job per step (target: email)
    const jobs = input.steps.map((step, i) => {
      const scheduledFor = new Date(startDate);
      scheduledFor.setDate(scheduledFor.getDate() + step.delayDays);
      return {
        domainId: input.domainId,
        contentId: step.contentId,
        target: "email" as const,
        scheduledFor,
      };
    });

    const created = await bulkCreatePublishingJobs(jobs);

    // Send first step immediately via Resend if no delay
    const firstStep = input.steps[0];
    if (firstStep && firstStep.delayDays === 0) {
      const res = await fetch(`${RESEND_API}/emails`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: `${input.fromName} <${input.fromEmail}>`,
          to: ["audience"],
          reply_to: input.replyTo,
          subject: firstStep.subject,
          html: firstStep.htmlBody,
        }),
      });
      if (!res.ok) {
        const errBody = await res.text().catch(() => "");
        logger.error(`[email-series] Failed to send first step via Resend (${res.status}):`, errBody);
      }
    }

    await audit({
      orgId: org.id,
      actorId: user.id,
      action: "publishing.email_series_created",
      entityType: "publishing_job",
      entityId: undefined,
      details: {
        seriesName: input.seriesName,
        stepCount: input.steps.length,
        domainId: input.domainId,
      },
    });

    return {
      created,
      stepCount: created.length,
      seriesName: input.seriesName,
    };
  });
