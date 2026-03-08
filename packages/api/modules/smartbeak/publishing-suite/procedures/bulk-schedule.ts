import { ORPCError } from "@orpc/server";
import {
	bulkCreatePublishingJobs,
	bulkScheduleInputSchema,
	getContentItemsByIds,
	getDomainById,
} from "@repo/database";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

const UNSUPPORTED_TARGET_MESSAGES = {
	web: "Web publishing jobs are not supported yet. Use SmartDeploy directly instead of the publishing queue.",
	email:
		"Email publishing jobs are not supported yet. The current email adapter cannot safely model recipients or per-message content.",
	youtube:
		"YouTube publishing jobs are not supported yet. The current publishing queue cannot upload the required video assets.",
	instagram:
		"Instagram publishing jobs are not supported yet. The current publishing queue cannot attach the required media assets.",
	tiktok:
		"TikTok publishing jobs are not supported yet. The current publishing queue cannot attach the required video assets.",
	vimeo:
		"Vimeo publishing jobs are not supported yet. The current publishing queue cannot attach the required video assets.",
} as const;

export const bulkScheduleProcedure = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/publishing-suite/jobs/bulk",
		tags: ["SmartBeak - Publishing Suite"],
		summary: "Bulk-schedule multiple publishing jobs",
	})
	.input(bulkScheduleInputSchema)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgEditor(org.supastarterOrgId, user.id);

		const domain = await getDomainById(input.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
		}

		const contentIds = [
			...new Set(
				input.jobs.map((j) => j.contentId).filter(Boolean) as string[],
			),
		];
		if (contentIds.length > 0) {
			const items = await getContentItemsByIds(contentIds);
			const validIds = new Set(
				items
					.filter((c) => c.domainId === input.domainId)
					.map((c) => c.id),
			);
			for (const cid of contentIds) {
				if (!validIds.has(cid)) {
					throw new ORPCError("BAD_REQUEST", {
						message: `Content item ${cid} does not belong to this domain.`,
					});
				}
			}
		}
		const unsupportedJob = input.jobs.find(
			(job) => job.target in UNSUPPORTED_TARGET_MESSAGES,
		);
		if (unsupportedJob) {
			throw new ORPCError("PRECONDITION_FAILED", {
				message: UNSUPPORTED_TARGET_MESSAGES[unsupportedJob.target],
			});
		}

		const jobsToCreate = input.jobs.map((j) => ({
			domainId: input.domainId,
			contentId: j.contentId,
			target: j.target,
			scheduledFor: new Date(j.scheduledFor),
		}));

		const created = await bulkCreatePublishingJobs(jobsToCreate);
		if (created.length !== jobsToCreate.length) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "Failed to create all publishing jobs.",
			});
		}

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "publishing.bulk_scheduled",
			entityType: "publishing_job",
			entityId: undefined,
			details: { count: created.length, domainId: input.domainId },
		});

		return { created, count: created.length };
	});
