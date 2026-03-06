import { ORPCError } from "@orpc/server";
import {
	countMediaAssetsForDomain,
	getDomainById,
	getMediaAssetsForDomain,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const listMedia = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/media",
		tags: ["SmartBeak - Media"],
		summary: "List media assets for a domain",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			domainId: z.string().uuid(),
			type: z.string().optional(),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);
		const domain = await getDomainById(input.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
		}
		const [items, total] = await Promise.all([
			getMediaAssetsForDomain(input.domainId, {
				type: input.type,
				limit: input.limit,
				offset: input.offset,
			}),
			countMediaAssetsForDomain(input.domainId, { type: input.type }),
		]);
		return { items, total };
	});
