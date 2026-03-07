import { ORPCError } from "@orpc/server";
import {
	bulkCreatePublishingJobs,
	bulkScheduleInputSchema,
	getContentItemById,
	getDomainById,
} from "@repo/database";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

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
		for (const cid of contentIds) {
			const content = await getContentItemById(cid);
			if (!content || content.domainId !== input.domainId) {
				throw new ORPCError("BAD_REQUEST", {
					message: `Content item ${cid} does not belong to this domain.`,
				});
			}
		}

		const jobsToCreate = input.jobs.map((j) => ({
			domainId: input.domainId,
			contentId: j.contentId,
			target: j.target,
			scheduledFor: new Date(j.scheduledFor),
		}));

		const created = await bulkCreatePublishingJobs(jobsToCreate);

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
