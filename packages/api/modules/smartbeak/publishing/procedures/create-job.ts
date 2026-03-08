import { ORPCError } from "@orpc/server";
import {
	createPublishingJob,
	getContentItemById,
	getDomainById,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

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

const UNSUPPORTED_TARGET_MESSAGES: Partial<
	Record<(typeof PUBLISH_TARGETS)[number], string>
> = {
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
};

export const createPublishingJobProcedure = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/publishing/jobs",
		tags: ["SmartBeak - Publishing"],
		summary: "Create a publishing job",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			domainId: z.string().uuid(),
			contentId: z.string().uuid().optional(),
			target: z.enum(PUBLISH_TARGETS),
			scheduledFor: z.string().datetime().nullable().optional(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgEditor(org.supastarterOrgId, user.id);
		const domain = await getDomainById(input.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
		}
		const unsupportedMessage = UNSUPPORTED_TARGET_MESSAGES[input.target];
		if (unsupportedMessage) {
			throw new ORPCError("PRECONDITION_FAILED", {
				message: unsupportedMessage,
			});
		}
		if (input.contentId) {
			const content = await getContentItemById(input.contentId);
			if (!content || content.domainId !== input.domainId) {
				throw new ORPCError("BAD_REQUEST", {
					message: "Content must belong to the specified domain.",
				});
			}
		}
		const [job] = await createPublishingJob({
			domainId: input.domainId,
			contentId: input.contentId,
			target: input.target,
			scheduledFor: input.scheduledFor
				? new Date(input.scheduledFor)
				: undefined,
		});
		if (!job) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "Failed to create publishing job.",
			});
		}
		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "publishing.job_created",
			entityType: "publishing_job",
			entityId: job.id,
			details: { target: input.target, domainId: input.domainId },
		});
		return { job };
	});
