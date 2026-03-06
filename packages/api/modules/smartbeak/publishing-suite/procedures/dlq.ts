import { ORPCError } from "@orpc/server";
import {
	bulkRetryJobsForOrg,
	getFailedJobsForDLQ,
	getFailedWebhookEvents,
	incrementWebhookReplayCount,
	retryPublishingJobForOrg,
} from "@repo/database";
import z from "zod";
import {
	adminProcedure,
	protectedProcedure,
} from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const listDlqJobsProcedure = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/publishing-suite/dlq/jobs",
		tags: ["SmartBeak - Publishing Suite"],
		summary: "List failed publishing jobs in the dead-letter queue",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgEditor(org.supastarterOrgId, user.id);
		const jobs = await getFailedJobsForDLQ(org.id, {
			limit: input.limit,
			offset: input.offset,
		});
		return { jobs, count: jobs.length };
	});

export const retryDlqJobProcedure = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/publishing-suite/dlq/jobs/:jobId/retry",
		tags: ["SmartBeak - Publishing Suite"],
		summary: "Retry a single failed publishing job from the DLQ",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			jobId: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgEditor(org.supastarterOrgId, user.id);
		const [job] = await retryPublishingJobForOrg(input.jobId, org.id);
		if (!job) {
			throw new ORPCError("NOT_FOUND", {
				message:
					"Job not found or does not belong to this organization.",
			});
		}
		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "publishing.dlq_retry",
			entityType: "publishing_job",
			entityId: input.jobId,
			details: {},
		});
		return { job };
	});

export const bulkRetryDlqProcedure = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/publishing-suite/dlq/jobs/bulk-retry",
		tags: ["SmartBeak - Publishing Suite"],
		summary: "Bulk retry multiple failed publishing jobs from the DLQ",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			jobIds: z.array(z.string().uuid()).min(1).max(50),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgEditor(org.supastarterOrgId, user.id);
		const jobs = await bulkRetryJobsForOrg(input.jobIds, org.id);
		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "publishing.dlq_bulk_retry",
			entityType: "publishing_job",
			entityId: undefined,
			details: { count: jobs.length },
		});
		return { jobs, count: jobs.length };
	});

export const listFailedWebhooksProcedure = adminProcedure
	.route({
		method: "GET",
		path: "/smartbeak/publishing-suite/dlq/webhooks",
		tags: ["SmartBeak - Publishing Suite"],
		summary:
			"List failed webhook events in the DLQ (admin only — webhook_events has no org scope)",
	})
	.input(
		z.object({
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ input }) => {
		const events = await getFailedWebhookEvents({
			limit: input.limit,
			offset: input.offset,
		});
		return { events, count: events.length };
	});

export const replayWebhookProcedure = adminProcedure
	.route({
		method: "POST",
		path: "/smartbeak/publishing-suite/dlq/webhooks/:eventId/replay",
		tags: ["SmartBeak - Publishing Suite"],
		summary:
			"Replay a failed webhook event (admin only — webhook_events has no org scope)",
	})
	.input(
		z.object({
			eventId: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		await incrementWebhookReplayCount(input.eventId);
		await audit({
			orgId: "system",
			actorId: user.id,
			action: "publishing.webhook_replay",
			entityType: "webhook_event",
			entityId: input.eventId,
			details: {},
		});
		return { replayed: true };
	});
