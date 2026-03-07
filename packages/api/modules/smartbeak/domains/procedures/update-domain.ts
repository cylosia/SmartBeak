import { ORPCError } from "@orpc/server";
import { getDomainById, updateDomain } from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgAdmin } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const updateDomainProcedure = protectedProcedure
	.route({
		method: "PATCH",
		path: "/smartbeak/domains/{id}",
		tags: ["SmartBeak - Domains"],
		summary: "Update a domain",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			id: z.string().uuid(),
			name: z.string().min(1).max(255).optional(),
			status: z
				.enum(["active", "pending", "suspended", "deployed"])
				.optional(),
			themeId: z.string().min(1).optional(),
			deployedUrl: z
				.string()
				.url()
				.refine(
					(v) => v.startsWith("https://") || v.startsWith("http://"),
					{ message: "URL must use http or https" },
				)
				.nullable()
				.optional(),
			registryData: z
				.record(z.string(), z.unknown())
				.nullable()
				.optional()
				.refine(
					(v) =>
						v === null ||
						v === undefined ||
						JSON.stringify(v).length <= 50_000,
					"Payload too large",
				),
			health: z
				.record(z.string(), z.unknown())
				.nullable()
				.optional()
				.refine(
					(v) =>
						v === null ||
						v === undefined ||
						JSON.stringify(v).length <= 50_000,
					"Payload too large",
				),
			lifecycle: z
				.record(z.string(), z.unknown())
				.nullable()
				.optional()
				.refine(
					(v) =>
						v === null ||
						v === undefined ||
						JSON.stringify(v).length <= 50_000,
					"Payload too large",
				),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		const existing = await getDomainById(input.id);
		if (!existing || existing.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
		}
		const { organizationSlug, id, ...updateData } = input;
		const [domain] = await updateDomain(id, updateData);
		if (!domain) {
			throw new ORPCError("CONFLICT", {
				message: "Domain was modified or deleted.",
			});
		}
		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "domain.updated",
			entityType: "domain",
			entityId: id,
			details: updateData as Record<string, unknown>,
		});
		return { domain };
	});
