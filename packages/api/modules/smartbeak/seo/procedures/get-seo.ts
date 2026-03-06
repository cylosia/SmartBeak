import { ORPCError } from "@orpc/server";
import {
	getDomainById,
	getKeywordsForDomain,
	getSeoDocumentForDomain,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const getSeo = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/seo",
		tags: ["SmartBeak - SEO"],
		summary: "Get SEO document and keywords for a domain",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			domainId: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);
		const domain = await getDomainById(input.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
		}
		const [seoDoc, keywords] = await Promise.all([
			getSeoDocumentForDomain(input.domainId),
			getKeywordsForDomain(input.domainId),
		]);
		return { seoDoc, keywords };
	});
