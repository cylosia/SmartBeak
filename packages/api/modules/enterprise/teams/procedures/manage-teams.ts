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
import { requireOrgAdmin, requireOrgMembership } from "../../lib/membership";
import { resolveSmartBeakOrg } from "../../lib/resolve-org";
import { audit } from "../../lib/audit";
import { createTeamActivity } from "@repo/database";

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
      organizationSlug: z.string().min(1),
      name: z.string().min(1, "Team name is required").max(100),
      description: z.string().max(500).optional(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgAdmin(org.supastarterOrgId, user.id);

    const slug = slugify(input.name, { lowercase: true });
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
      organizationSlug: z.string().min(1),
      teamId: z.string().uuid(),
      name: z.string().min(1).max(100).optional(),
      description: z.string().max(500).nullable().optional(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgAdmin(org.supastarterOrgId, user.id);

    const team = await getTeamById(input.teamId);
    if (!team || team.orgId !== org.id) {
      throw new ORPCError("NOT_FOUND", { message: "Team not found." });
    }

    const updated = await updateTeam(input.teamId, {
      name: input.name,
      description: input.description,
    });

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
      organizationSlug: z.string().min(1),
      teamId: z.string().uuid(),
    }),
  )
  .handler(async ({ context: { user }, input }) => {
    const org = await resolveSmartBeakOrg(input.organizationSlug);
    await requireOrgAdmin(org.supastarterOrgId, user.id);

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
