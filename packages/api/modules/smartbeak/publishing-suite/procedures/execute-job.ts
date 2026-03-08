import { ORPCError } from "@orpc/server";
import {
	claimPublishingJobForExecution,
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
import { getAdapter, type PublishResult } from "../adapters";

const MAX_ATTEMPTS = 3;
const UNSUPPORTED_EXECUTION_MESSAGES = {
	web: "Web publishing is not supported yet. Use SmartDeploy directly instead of the publishing queue.",
	email:
		"Email publishing is not supported yet. The current email adapter cannot safely model recipients or per-message content.",
	youtube:
		"YouTube publishing is not supported yet. The current publishing queue cannot upload the required video assets.",
	instagram:
		"Instagram publishing is not supported yet. The current publishing queue cannot attach the required media assets.",
	tiktok:
		"TikTok publishing is not supported yet. The current publishing queue cannot attach the required video assets.",
	vimeo:
		"Vimeo publishing is not supported yet. The current publishing queue cannot attach the required video assets.",
} as const;

export const executePublishingJobProcedure = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/publishing-suite/jobs/:jobId/execute",
		tags: ["SmartBeak - Publishing Suite"],
		summary: "Execute a publishing job through its platform adapter",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
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
			throw new ORPCError("NOT_FOUND", { message: "Job not found." });
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

		const unsupportedMessage =
			UNSUPPORTED_EXECUTION_MESSAGES[
				job.target as keyof typeof UNSUPPORTED_EXECUTION_MESSAGES
			];
		if (unsupportedMessage) {
			await updatePublishingJobStatus(input.jobId, "failed", {
				error: unsupportedMessage,
			});
			throw new ORPCError("PRECONDITION_FAILED", {
				message: unsupportedMessage,
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
			if (!content || content.domainId !== job.domainId) {
				await updatePublishingJobStatus(input.jobId, "failed", {
					error: "Associated content item is missing or does not belong to this domain.",
				});
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Associated content item is missing or does not belong to this domain.",
				});
			}
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

		const [claimedJob] = await claimPublishingJobForExecution(input.jobId);
		if (!claimedJob) {
			throw new ORPCError("CONFLICT", {
				message:
					"Job is already running or has already been processed.",
			});
		}

		// Execute
		let result: PublishResult;
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
