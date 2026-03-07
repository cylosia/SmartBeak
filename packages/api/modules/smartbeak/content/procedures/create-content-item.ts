import { ORPCError } from "@orpc/server";
import { createContentItem, getDomainById } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const createContentItemProcedure = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/content",
		tags: ["SmartBeak - Content"],
		summary: "Create a new content item",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			domainId: z.string().uuid(),
			title: z.string().min(1).max(500),
			body: z.string().max(500000).optional(),
			status: z
				.enum(["draft", "published", "scheduled", "archived"])
				.optional(),
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
		const rows = await createContentItem({
			domainId: input.domainId,
			title: input.title,
			body: input.body,
			status: input.status ?? "draft",
			scheduledFor: input.scheduledFor
				? new Date(input.scheduledFor)
				: undefined,
			createdBy: user.id,
		});
		const item = rows[0];
		if (!item) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "Failed to create content item.",
			});
		}
		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "content.created",
			entityType: "content_item",
			entityId: item.id,
			details: { title: input.title, domainId: input.domainId },
		});
		return { item };
	});
