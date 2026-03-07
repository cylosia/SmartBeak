import { ORPCError } from "@orpc/server";
import { getDomainById } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const getDomain = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/domains/{id}",
		tags: ["SmartBeak - Domains"],
		summary: "Get a domain by ID",
	})
	.input(
		z.object({
			id: z.string().uuid(),
			organizationSlug: z.string().min(1).max(255),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);
		const domain = await getDomainById(input.id);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
		}
		return { domain };
	});
