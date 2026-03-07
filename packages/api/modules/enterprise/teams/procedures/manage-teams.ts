/**
 * Enterprise Teams — CRUD procedures.
 * Requires admin or owner role at the organization level.
 */

import { ORPCError } from "@orpc/server";
import {
	createTeam,
	deleteTeam,
	getTeamById,
	getTeamBySlug,
	getTeamsForOrg,
	updateTeam,
} from "@repo/database";
import slugify from "@sindresorhus/slugify";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireEnterpriseFeature } from "../../lib/feature-gate";
import { requireOrgAdmin, requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const listTeams = protectedProcedure
	.route({
		method: "GET",
		path: "/enterprise/teams",
		tags: ["Enterprise - Teams"],
		summary: "List all teams in an organization",
	})
	.input(z.object({ organizationSlug: z.string().min(1) }))
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "teams");
		const teams = await getTeamsForOrg(org.id);
		return { teams };
	});

export const createTeamProcedure = protectedProcedure
	.route({
		method: "POST",
		path: "/enterprise/teams",
		tags: ["Enterprise - Teams"],
		summary: "Create a new team workspace",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			name: z.string().min(1, "Team name is required").max(100),
			description: z.string().max(500).optional(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "teams");

		const slug = slugify(input.name, { lowercase: true });
		if (!slug) {
			throw new ORPCError("BAD_REQUEST", {
				message: "Team name must produce a valid URL slug.",
			});
		}
		const existing = await getTeamBySlug(org.id, slug);
		if (existing) {
			throw new ORPCError("CONFLICT", {
				message: `A team with the name "${input.name}" already exists.`,
			});
		}

		const team = await createTeam({
			orgId: org.id,
			name: input.name,
			slug,
			description: input.description,
			createdBy: user.id,
		});

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "enterprise.team.created",
			entityType: "enterprise_team",
			entityId: team.id,
			details: { name: team.name },
		});

		return { team };
	});

export const updateTeamProcedure = protectedProcedure
	.route({
		method: "PATCH",
		path: "/enterprise/teams/{teamId}",
		tags: ["Enterprise - Teams"],
		summary: "Update a team's name or description",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			teamId: z.string().uuid(),
			name: z.string().min(1).max(100).optional(),
			description: z.string().max(500).nullable().optional(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "teams");

		const team = await getTeamById(input.teamId);
		if (!team || team.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Team not found." });
		}

		const updateData: {
			name?: string;
			slug?: string;
			description?: string | null;
		} = {
			description: input.description,
		};
		if (input.name) {
			updateData.name = input.name;
			const newSlug = slugify(input.name, { lowercase: true });
			if (newSlug && newSlug !== team.slug) {
				const slugConflict = await getTeamBySlug(org.id, newSlug);
				if (slugConflict && slugConflict.id !== input.teamId) {
					throw new ORPCError("CONFLICT", {
						message: `A team with the slug "${newSlug}" already exists.`,
					});
				}
				updateData.slug = newSlug;
			}
		}
		const updated = await updateTeam(input.teamId, updateData);

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "enterprise.team.updated",
			entityType: "enterprise_team",
			entityId: input.teamId,
			details: { name: input.name, description: input.description },
		});

		return { team: updated };
	});

export const deleteTeamProcedure = protectedProcedure
	.route({
		method: "DELETE",
		path: "/enterprise/teams/{teamId}",
		tags: ["Enterprise - Teams"],
		summary: "Delete a team workspace",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1).max(255),
			teamId: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "teams");

		const team = await getTeamById(input.teamId);
		if (!team || team.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Team not found." });
		}

		await deleteTeam(input.teamId);

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "enterprise.team.deleted",
			entityType: "enterprise_team",
			entityId: input.teamId,
			details: { name: team.name },
		});

		return { success: true };
	});
