import { ORPCError } from "@orpc/server";
import {
	getContentItemById,
	getDomainById,
	getPublishAttemptsForJobFull,
	getPublishingJobById,
	getPublishTargetsForDomain,
	recordPublishAttempt,
	updatePublishingJobStatus,
} from "@repo/database";
import { logger } from "@repo/logs";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";
import { getAdapter } from "../adapters";

const MAX_ATTEMPTS = 3;

export const executePublishingJobProcedure = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/publishing-suite/jobs/:jobId/execute",
		tags: ["SmartBeak - Publishing Suite"],
		summary: "Execute a publishing job through its platform adapter",
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

		const job = await getPublishingJobById(input.jobId);
		if (!job) {
			throw new ORPCError("NOT_FOUND", { message: "Job not found." });
		}

		const domain = await getDomainById(job.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("FORBIDDEN", {
				message: "Job does not belong to this org.",
			});
		}

		const existingAttempts = await getPublishAttemptsForJobFull(
			input.jobId,
		);
		const alreadyPublished = existingAttempts.some(
			(a) => a.status === "success",
		);
		if (alreadyPublished) {
			await updatePublishingJobStatus(input.jobId, "published");
			return { success: true, result: { alreadyPublished: true } };
		}

		const attemptCount = existingAttempts.length;
		if (attemptCount >= MAX_ATTEMPTS) {
			await updatePublishingJobStatus(input.jobId, "failed", {
				error: `Max retry attempts (${MAX_ATTEMPTS}) exceeded.`,
			});
			throw new ORPCError("BAD_REQUEST", {
				message: `Max retry attempts (${MAX_ATTEMPTS}) exceeded. Job moved to DLQ.`,
			});
		}

		const targets = await getPublishTargetsForDomain(job.domainId);
		const targetConfig = targets.find(
			(t) => t.target === job.target && t.enabled,
		);
		if (!targetConfig) {
			await updatePublishingJobStatus(input.jobId, "failed", {
				error: `No enabled publish target config found for ${job.target}.`,
			});
			throw new ORPCError("BAD_REQUEST", {
				message: `No enabled publish target config for ${job.target}.`,
			});
		}

		let config: Record<string, unknown> = {};
		try {
			const { decrypt } = await import("@repo/utils");
			const configSecret = process.env.SMARTBEAK_ENCRYPTION_KEY;
			if (!configSecret) {
				throw new ORPCError("PRECONDITION_FAILED", {
					message:
						"Encryption key not configured. Contact your administrator.",
				});
			}
			const configJson = await decrypt(
				targetConfig.encryptedConfig,
				configSecret,
			);
			config = JSON.parse(configJson);
		} catch (decryptErr) {
			logger.error(
				"[execute-job] Failed to decrypt publish target config:",
				decryptErr,
			);
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "Failed to decrypt publishing credentials.",
			});
		}

		// Get content payload
		let payload = {
			title: domain.name,
			body: "",
			excerpt: "",
			mediaUrls: [] as string[],
			tags: [] as string[],
		};
		if (job.contentId) {
			const content = await getContentItemById(job.contentId);
			if (content) {
				payload = {
					title: content.title,
					body:
						typeof content.body === "string"
							? content.body
							: JSON.stringify(content.body),
					excerpt: "",
					mediaUrls: [],
					tags: [],
				};
			}
		}

		// Get adapter
		const adapter = getAdapter(job.target);
		if (!adapter) {
			await updatePublishingJobStatus(input.jobId, "failed", {
				error: `No adapter found for target: ${job.target}`,
			});
			throw new ORPCError("BAD_REQUEST", {
				message: `Unsupported target: ${job.target}`,
			});
		}

		// Mark as running
		await updatePublishingJobStatus(input.jobId, "running");

		// Execute
		let result: Awaited<ReturnType<typeof adapter.publish>>;
		try {
			result = await adapter.publish(config, payload);
		} catch (err) {
			const errorMsg = err instanceof Error ? err.message : String(err);
			logger.error("[execute-job] publish error:", err);
			await recordPublishAttempt({
				jobId: input.jobId,
				status: "error",
				response: { error: errorMsg },
			});
			await updatePublishingJobStatus(input.jobId, "failed", {
				error: errorMsg,
			});
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message:
					"Publishing failed. Check the job details for more information.",
			});
		}

		// Record attempt
		await recordPublishAttempt({
			jobId: input.jobId,
			status: result.success ? "success" : "failed",
			response: {
				platformPostId: result.platformPostId,
				url: result.url,
				error: result.error,
				views: result.views ?? 0,
				engagement: result.engagement ?? 0,
				clicks: result.clicks ?? 0,
				impressions: result.impressions ?? 0,
			},
		});

		if (result.success) {
			await updatePublishingJobStatus(input.jobId, "published", {
				executedAt: new Date(),
			});
			await audit({
				orgId: org.id,
				actorId: user.id,
				action: "publishing.job_executed",
				entityType: "publishing_job",
				entityId: input.jobId,
				details: {
					target: job.target,
					platformPostId: result.platformPostId,
				},
			});
		} else {
			const newCount = attemptCount + 1;
			const newStatus = newCount >= MAX_ATTEMPTS ? "failed" : "pending";
			await updatePublishingJobStatus(input.jobId, newStatus, {
				error: result.error,
			});
		}

		return { success: result.success, result };
	});
