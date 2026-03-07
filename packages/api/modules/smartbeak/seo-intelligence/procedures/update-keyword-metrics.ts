import { ORPCError } from "@orpc/server";
import {
	getDomainById,
	getKeywordById,
	recalculateDecayFactor,
	updateKeywordMetrics,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgEditor } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const updateKeyword = protectedProcedure
	.route({
		method: "PATCH",
		path: "/smartbeak/seo-intelligence/keywords/{id}",
		tags: ["SmartBeak - SEO Intelligence"],
		summary: "Update keyword metrics (position, volume, difficulty)",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			id: z.string().uuid(),
			position: z.number().int().min(1).nullable().optional(),
			volume: z.number().int().min(0).nullable().optional(),
			difficulty: z.number().int().min(0).max(100).nullable().optional(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgEditor(org.supastarterOrgId, user.id);

		const kw = await getKeywordById(input.id);
		if (!kw) {
			throw new ORPCError("NOT_FOUND", { message: "Keyword not found." });
		}

		const domain = await getDomainById(kw.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("FORBIDDEN", { message: "Access denied." });
		}

		const [updated] = await updateKeywordMetrics(input.id, {
			position: input.position,
			volume: input.volume,
			difficulty: input.difficulty,
		});

		// Recalculate decay factor after update
		const [withDecay] = await recalculateDecayFactor(
			input.id,
			updated.lastUpdated,
		);

		return { keyword: withDecay };
	});
