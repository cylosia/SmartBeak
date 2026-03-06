import { ORPCError } from "@orpc/server";
import { getOrganizationMembership } from "@repo/database";

/**
 * Verifies that a user is a member of an organization via the Supastarter
 * better-auth `member` table (which is the authoritative membership source).
 * Returns the membership record or throws FORBIDDEN.
 */
export async function requireOrgMembership(
	organizationId: string,
	userId: string,
) {
	const membership = await getOrganizationMembership(organizationId, userId);
	if (!membership) {
		throw new ORPCError("FORBIDDEN", {
			message: "You are not a member of this organization.",
		});
	}
	return membership;
}

/**
 * Verifies that a user has at least admin-level access (owner or admin role)
 * in the Supastarter better-auth `member` table.
 */
export async function requireOrgAdmin(organizationId: string, userId: string) {
	const membership = await requireOrgMembership(organizationId, userId);
	if (membership.role !== "owner" && membership.role !== "admin") {
		throw new ORPCError("FORBIDDEN", {
			message: "Admin or owner role required.",
		});
	}
	return membership;
}

/**
 * Verifies that a user has at least editor-level access
 * (owner, admin, or editor role).
 */
export async function requireOrgEditor(organizationId: string, userId: string) {
	const membership = await requireOrgMembership(organizationId, userId);
	if (
		membership.role !== "owner" &&
		membership.role !== "admin" &&
		membership.role !== "editor"
	) {
		throw new ORPCError("FORBIDDEN", {
			message: "Editor, admin, or owner role required.",
		});
	}
	return membership;
}
