import { ORPCError } from "@orpc/server";
import {
	getDiligenceReport,
	getDomainById,
	runDiligenceChecksForDomain,
	upsertDiligenceCheck,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireOrgAdmin, requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

const domainInput = z.object({
	organizationSlug: z.string().min(1),
	domainId: z.string().uuid(),
});

export const getDiligenceReportProc = protectedProcedure
	.route({
		method: "GET",
		path: "/smartbeak/analytics/diligence",
		tags: ["SmartBeak - Analytics"],
		summary: "Get diligence report for a domain",
	})
	.input(domainInput)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);

		const domain = await getDomainById(input.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
		}

		const report = await getDiligenceReport(input.domainId);
		return { report };
	});

export const runDiligenceEngine = protectedProcedure
	.route({
		method: "POST",
		path: "/smartbeak/analytics/diligence/run",
		tags: ["SmartBeak - Analytics"],
		summary: "Run automated diligence checks for a domain",
	})
	.input(domainInput)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);

		const domain = await getDomainById(input.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
		}

		const results = await runDiligenceChecksForDomain(input.domainId);
		const report = await getDiligenceReport(input.domainId);

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "diligence.run",
			entityType: "domain",
			entityId: input.domainId,
			details: {
				score: report.score,
				passed: report.passed,
				failed: report.failed,
			},
		});

		return { results, report };
	});

export const updateDiligenceCheck = protectedProcedure
	.route({
		method: "PATCH",
		path: "/smartbeak/analytics/diligence/check",
		tags: ["SmartBeak - Analytics"],
		summary: "Manually update a diligence check",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			domainId: z.string().uuid(),
			type: z.string().min(1),
			status: z.enum(["pending", "passed", "failed", "skipped"]),
			result: z
				.record(z.string(), z.unknown())
				.refine(
					(v) => JSON.stringify(v).length <= 10_000,
					"Result payload too large",
				)
				.optional(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);

		const domain = await getDomainById(input.domainId);
		if (!domain || domain.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Domain not found." });
		}

		const updated = await upsertDiligenceCheck({
			domainId: input.domainId,
			type: input.type,
			status: input.status,
			result: input.result,
			completedAt: new Date(),
		});

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "diligence.check.update",
			entityType: "diligence_check",
			entityId: input.domainId,
			details: { type: input.type, status: input.status },
		});

		const check = updated[0];
		if (!check) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "Failed to upsert diligence check.",
			});
		}
		return { check };
	});
