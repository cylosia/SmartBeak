import { countDomainsForOrg, getDomainsForOrg } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const listDomains = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/domains",
		tags: ["SmartBeak - Domains"],
		summary: "List domains for an organization",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			query: z.string().max(255).optional(),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);
		const [items, total] = await Promise.all([
			getDomainsForOrg(org.id, {
				query: input.query,
				limit: input.limit,
				offset: input.offset,
			}),
			countDomainsForOrg(org.id, { query: input.query }),
		]);
		return { items, total };
	});
