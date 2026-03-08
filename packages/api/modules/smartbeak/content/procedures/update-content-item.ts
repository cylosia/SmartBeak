import { ORPCError } from "@orpc/server";
import {
	createContentRevision,
	getContentItemById,
	getDomainById,
	updateContentItem,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const updateContentItemProcedure = protectedProcedure
	.route({
		method: "PATCH",
		path: "/smartbeak/content/{id}",
		tags: ["SmartBeak - Content"],
		summary: "Update a content item (creates a revision snapshot)",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			id: z.string().uuid(),
			title: z.string().min(1).max(500).optional(),
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
		const existing = await getContentItemById(input.id);
		if (!existing) {
			throw new ORPCError("NOT_FOUND", {
				message: "Content item not found.",
			});
		}
		const domain = await getDomainById(existing.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("FORBIDDEN", { message: "Access denied." });
		}

		const nextStatus = input.status ?? existing.status;
		const nextScheduledFor =
			input.scheduledFor === null
				? null
				: input.scheduledFor
					? new Date(input.scheduledFor)
					: existing.scheduledFor;
		if (nextStatus === "scheduled") {
			if (!nextScheduledFor || Number.isNaN(nextScheduledFor.getTime())) {
				throw new ORPCError("BAD_REQUEST", {
					message:
						"Scheduled content must include a valid scheduled publish time.",
				});
			}
		} else if (
			input.scheduledFor !== undefined &&
			nextScheduledFor !== null
		) {
			throw new ORPCError("BAD_REQUEST", {
				message:
					"scheduledFor can only be provided when status is set to scheduled.",
			});
		}

		// Snapshot current body as a revision before overwriting
		if (input.body !== undefined && input.body !== existing.body) {
			await createContentRevision({
				contentId: existing.id,
				version: existing.version,
				body: existing.body ?? undefined,
				changedBy: user.id,
			});
		}

		const newVersion =
			existing.version + (input.body !== undefined ? 1 : 0);
		const { organizationSlug, id, ...updateData } = input;
		const [item] = await updateContentItem(
			id,
			{
				...updateData,
				scheduledFor:
					nextStatus === "scheduled"
						? nextScheduledFor
						: updateData.scheduledFor !== undefined ||
								existing.scheduledFor !== null
							? null
							: undefined,
				version: newVersion,
				updatedBy: user.id,
				publishedAt:
					updateData.status === "published" &&
					existing.status !== "published"
						? new Date()
						: undefined,
			},
			existing.version,
		);
		if (!item) {
			throw new ORPCError("CONFLICT", {
				message:
					"Content was modified concurrently. Please reload and try again.",
			});
		}
		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "content.updated",
			entityType: "content_item",
			entityId: id,
			details: { status: updateData.status },
		});
		return { item };
	});
