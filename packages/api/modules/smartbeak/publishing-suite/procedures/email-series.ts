import { ORPCError } from "@orpc/server";
import { emailSeriesInputSchema, getDomainById } from "@repo/database";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const createEmailSeriesProcedure = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/publishing-suite/email-series",
		tags: ["SmartBeak - Publishing Suite"],
		summary: "Create a drip email series (planned)",
	})
	.input(emailSeriesInputSchema)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgEditor(org.supastarterOrgId, user.id);

		const domain = await getDomainById(input.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
		}
		throw new ORPCError("PRECONDITION_FAILED", {
			message:
				"Email series automation is not available yet. The current publishing queue cannot safely persist per-step email bodies, subjects, or recipients.",
		});
	});
