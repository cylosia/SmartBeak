import { ORPCError } from "@orpc/server";
import { getDomainById, getSiteShardsForDomain } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const getDeployStatus = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/deploy/status",
		tags: ["SmartBeak - Deploy"],
		summary: "Get deployment status and shard history for a domain",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			domainId: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);

		const domain = await getDomainById(input.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", {
				message: "Domain not found.",
			});
		}

		const shards = await getSiteShardsForDomain(domain.id);
		const latest = shards[0] ?? null;
		const isInProgress =
			domain.status === "pending" || domain.status === "building";

		return {
			domain: {
				id: domain.id,
				name: domain.name,
				deployedUrl: domain.deployedUrl,
				themeId: domain.themeId,
				status: domain.status,
			},
			latest,
			shards,
			isInProgress,
			lastError: latest?.status === "error" ? latest.errorMessage : null,
		};
	});
