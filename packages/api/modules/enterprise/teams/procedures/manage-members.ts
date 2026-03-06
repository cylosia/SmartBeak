/**
 * Enterprise Teams — Member management procedures.
 * Covers adding, removing, and updating roles for team members.
 */

import { ORPCError } from "@orpc/server";
import {
	addTeamMember,
	createTeamActivity,
	getTeamActivity,
	getTeamById,
	getTeamMember,
	getTeamMembers,
	removeTeamMember,
	updateTeamMemberRole,
} from "@repo/database";
import z from "zod";
import { protectedProcedure } from "../../../../orpc/procedures";
import { audit } from "../../lib/audit";
import { requireEnterpriseFeature } from "../../lib/feature-gate";
import { requireOrgAdmin, requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";

export const listTeamMembers = protectedProcedure
	.route({
		method: "GET",
		path: "/enterprise/teams/{teamId}/members",
		tags: ["Enterprise - Teams"],
		summary: "List members of a team",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			teamId: z.string().uuid(),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "teams");

		const team = await getTeamById(input.teamId);
		if (!team || team.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Team not found." });
		}

		const members = await getTeamMembers(input.teamId);
		return { members };
	});

export const addTeamMemberProcedure = protectedProcedure
	.route({
		method: "POST",
		path: "/enterprise/teams/{teamId}/members",
		tags: ["Enterprise - Teams"],
		summary: "Add a user to a team",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			teamId: z.string().uuid(),
			userId: z.string().min(1),
			role: z.enum(["admin", "member"]).default("member"),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgAdmin(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "teams");

		await requireOrgMembership(org.supastarterOrgId, input.userId);

		const team = await getTeamById(input.teamId);
		if (!team || team.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Team not found." });
		}

		const member = await addTeamMember({
			teamId: input.teamId,
			userId: input.userId,
			role: input.role,
			invitedBy: user.id,
		});

		await createTeamActivity({
			teamId: input.teamId,
			actorId: user.id,
			action: "member.added",
			entityType: "user",
			entityId: input.userId,
			details: { role: input.role },
		});

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "enterprise.team.member.added",
			entityType: "enterprise_team",
			entityId: input.teamId,
			details: { userId: input.userId, role: input.role },
		});

		return { member };
	});

export const removeTeamMemberProcedure = protectedProcedure
	.route({
		method: "DELETE",
		path: "/enterprise/teams/{teamId}/members/{userId}",
		tags: ["Enterprise - Teams"],
		summary: "Remove a user from a team",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			teamId: z.string().uuid(),
			userId: z.string().min(1),
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

		const existing = await getTeamMember(input.teamId, input.userId);
		if (!existing) {
			throw new ORPCError("NOT_FOUND", {
				message: "User is not a member of this team.",
			});
		}

		await removeTeamMember(input.teamId, input.userId);

		await createTeamActivity({
			teamId: input.teamId,
			actorId: user.id,
			action: "member.removed",
			entityType: "user",
			entityId: input.userId,
		});

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "enterprise.team.member.removed",
			entityType: "enterprise_team",
			entityId: input.teamId,
			details: { userId: input.userId },
		});

		return { success: true };
	});

export const updateTeamMemberRoleProcedure = protectedProcedure
	.route({
		method: "PATCH",
		path: "/enterprise/teams/{teamId}/members/{userId}/role",
		tags: ["Enterprise - Teams"],
		summary: "Update a team member's role",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			teamId: z.string().uuid(),
			userId: z.string().min(1),
			role: z.enum(["admin", "member"]),
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

		const updated = await updateTeamMemberRole(
			input.teamId,
			input.userId,
			input.role,
		);

		if (!updated) {
			throw new ORPCError("NOT_FOUND", {
				message: "User is not a member of this team.",
			});
		}

		await createTeamActivity({
			teamId: input.teamId,
			actorId: user.id,
			action: "member.role_updated",
			entityType: "user",
			entityId: input.userId,
			details: { newRole: input.role },
		});

		await audit({
			orgId: org.id,
			actorId: user.id,
			action: "enterprise.team.member.role_updated",
			entityType: "enterprise_team",
			entityId: input.teamId,
			details: { userId: input.userId, role: input.role },
		});

		return { member: updated };
	});

export const listTeamActivityProcedure = protectedProcedure
	.route({
		method: "GET",
		path: "/enterprise/teams/{teamId}/activity",
		tags: ["Enterprise - Teams"],
		summary: "Get the activity log for a team",
	})
	.input(
		z.object({
			organizationSlug: z.string().min(1),
			teamId: z.string().uuid(),
			limit: z.number().int().min(1).max(100).default(50),
			offset: z.number().int().min(0).default(0),
		}),
	)
	.handler(async ({ context: { user }, input }) => {
		const org = await resolveSmartBeakOrg(input.organizationSlug);
		await requireOrgMembership(org.supastarterOrgId, user.id);
		await requireEnterpriseFeature(org.id, "teams");

		const team = await getTeamById(input.teamId);
		if (!team || team.orgId !== org.id) {
			throw new ORPCError("NOT_FOUND", { message: "Team not found." });
		}

		const activity = await getTeamActivity(input.teamId, {
			limit: input.limit,
			offset: input.offset,
		});

		return { activity };
	});
