import { ORPCError } from "@orpc/server";
import {
	getContentItemById,
	getContentRevisions,
	getDomainById,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const getContentItem = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/content/{id}",
		tags: ["SmartBeak - Content"],
		summary: "Get a content item with its revisions",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			id: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);
		const item = await getContentItemById(input.id);
		if (!item) {
			throw new ORPCError("NOT_FOUND", {
				message: "Content item not found.",
			});
		}
		const domain = await getDomainById(item.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("FORBIDDEN", { message: "Access denied." });
		}
		const revisions = await getContentRevisions(input.id);
		return { item, revisions };
	});
