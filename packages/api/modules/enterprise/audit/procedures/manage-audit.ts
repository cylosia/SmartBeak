/**
 * Enterprise Audit — Enhanced audit log procedures.
 *
 * Extends the basic audit log with:
 * - Full-text search and multi-field filtering
 * - CSV/JSON export with date range selection
 * - Retention policy management (SOC2-ready)
 */

import {
	getAuditEventsForExport,
	getAuditRetentionForOrg,
	searchAuditEvents,
	upsertAuditRetention,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireEnterpriseFeature } from "../../lib/feature-gate";
import { requireOrgAdmin } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

function escapeCsvField(value: string): string {
	const escaped = value.replace(/"/g, '""');
	if (/^[=+\-@\t\r]/.test(escaped)) {
		return `"'${escaped}"`;
	}
	return `"${escaped}"`;
}

export const searchAuditLogsProcedure = protectedProcedure
	.route({
		method: "GET",
		path: "/enterprise/audit/search",
		tags: ["Enterprise - Audit"],
		summary: "Search and filter the immutable audit log",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			query: z.string().max(200).optional(),
			entityType: z.string().max(100).optional(),
			actorId: z.string().max(100).optional(),
			action: z.string().max(100).optional(),
			startDate: z.string().datetime().optional(),
			endDate: z.string().datetime().optional(),
			limit: z.number().int().min(1).max(500).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "auditLog");

		const { items, total } = await searchAuditEvents(org.id, {
			query: input.query,
			entityType: input.entityType,
			actorId: input.actorId,
			action: input.action,
			startDate: input.startDate ? new Date(input.startDate) : undefined,
			endDate: input.endDate ? new Date(input.endDate) : undefined,
			limit: input.limit,
			offset: input.offset,
		});

		return { items, total };
	});

export const exportAuditLogsProcedure = protectedProcedure
	.route({
		method: "POST",
		path: "/enterprise/audit/export",
		tags: ["Enterprise - Audit"],
		summary: "Export audit log entries as CSV or JSON",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			format: z.enum(["csv", "json"]).default("csv"),
			startDate: z.string().datetime().optional(),
			endDate: z.string().datetime().optional(),
			entityType: z.string().max(100).optional(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "auditLog");

		const events = await getAuditEventsForExport(org.id, {
			startDate: input.startDate ? new Date(input.startDate) : undefined,
			endDate: input.endDate ? new Date(input.endDate) : undefined,
			entityType: input.entityType,
			limit: 5000,
		});

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "enterprise.audit.exported",
			entityType: "audit_log",
			details: {
				format: input.format,
				count: events.length,
				startDate: input.startDate,
				endDate: input.endDate,
			},
		});

		if (input.format === "json") {
			return {
				format: "json" as const,
				data: JSON.stringify(events, null, 2),
				filename: `audit-log-${org.slug}-${new Date().toISOString().split("T")[0]}.json`,
				count: events.length,
			};
		}

		// Build CSV
		const headers = [
			"id",
			"action",
			"entityType",
			"entityId",
			"actorId",
			"details",
			"createdAt",
		];
		const rows = events.map((e) =>
			[
				e.id,
				e.action,
				e.entityType,
				e.entityId ?? "",
				e.actorId ?? "",
				e.details ? JSON.stringify(e.details) : "",
				e.createdAt.toISOString(),
			]
				.map((v) => escapeCsvField(String(v)))
				.join(","),
		);
		const csv = [headers.join(","), ...rows].join("\n");

		return {
			format: "csv" as const,
			data: csv,
			filename: `audit-log-${org.slug}-${new Date().toISOString().split("T")[0]}.csv`,
			count: events.length,
		};
	});

export const getAuditRetentionProcedure = protectedProcedure
	.route({
		method: "GET",
		path: "/enterprise/audit/retention",
		tags: ["Enterprise - Audit"],
		summary: "Get the audit log retention policy for an organization",
	})
	.input(z.object({ organizationSlug: z.string().min(1) }))
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "auditLog");

		const retention = await getAuditRetentionForOrg(org.id);

		// Return defaults if no policy is configured.
		return {
			retention: retention ?? {
				id: null,
				orgId: org.id,
				retentionDays: 90,
				exportEnabled: false,
				exportSchedule: null,
				exportRecipients: null,
				updatedBy: null,
				updatedAt: new Date(),
			},
		};
	});

export const setAuditRetentionProcedure = protectedProcedure
	.route({
		method: "PUT",
		path: "/enterprise/audit/retention",
		tags: ["Enterprise - Audit"],
		summary: "Set the audit log retention policy for an organization",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			retentionDays: z
				.number()
				.int()
				.min(30, "Minimum retention is 30 days")
				.max(2555, "Maximum retention is 7 years"),
			exportEnabled: z.boolean().default(false),
			exportSchedule: z
				.string()
				.regex(
					/^(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)\s+(\*|[0-9,\-*/]+)$/,
					"Must be a valid cron expression",
				)
				.optional(),
			exportRecipients: z
				.string()
				.max(1000)
				.optional()
				.refine(
					(val) => {
						if (!val) {
							return true;
						}
						const emails = val.split(",").map((e) => e.trim());
						return emails.every((e) =>
							/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e),
						);
					},
					{
						message:
							"exportRecipients must be a comma-separated list of valid email addresses",
					},
				),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "auditLog");

		const retention = await upsertAuditRetention({
			orgId: org.id,
			retentionDays: input.retentionDays,
			exportEnabled: input.exportEnabled,
			exportSchedule: input.exportSchedule,
			exportRecipients: input.exportRecipients,
			updatedBy: user.id,
		});

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "enterprise.audit.retention.updated",
			entityType: "enterprise_audit_retention",
			entityId: retention.id,
			details: {
				retentionDays: input.retentionDays,
				exportEnabled: input.exportEnabled,
			},
		});

		return { retention };
	});
