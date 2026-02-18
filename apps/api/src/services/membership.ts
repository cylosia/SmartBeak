/**
 * P2-FIX (P2-8): Extracted verifyOrgMembership into a shared service.
 *
 * Previously, four billing route files (billingStripe.ts, billingPaddle.ts,
 * billingInvoiceExport.ts, billingInvoices.ts) each contained an identical
 * local copy of this function. Any change to org membership logic (e.g. role-
 * based access, multi-tenancy) must be applied exactly once here.
 *
 * P2-FIX (P2-12): Added minRole parameter. Previously any membership row
 * satisfied the check regardless of role, meaning viewer-level users could
 * reach billing and admin endpoints that require owner/admin access.
 */

import { getDb } from '../db';

/** Roles in ascending privilege order. */
export type OrgRole = 'viewer' | 'editor' | 'admin' | 'owner';

const ROLE_RANK: Record<OrgRole, number> = {
  viewer: 1,
  editor: 2,
  admin: 3,
  owner: 4,
};

/**
 * Verify that a user is a member of an organization with at least the given role.
 *
 * @param userId   - ID of the user to check
 * @param orgId    - ID of the organization
 * @param minRole  - Minimum role required (default: 'viewer' — preserves old behaviour)
 * @returns true if the membership row exists and the role meets minRole, false otherwise.
 */
export async function verifyOrgMembership(
  userId: string,
  orgId: string,
  minRole: OrgRole = 'viewer'
): Promise<boolean> {
  const db = await getDb();
  const membership = await db('org_memberships')
    .where({ user_id: userId, org_id: orgId })
    .first<{ role: OrgRole } | undefined>();

  if (!membership) return false;

  const memberRank = ROLE_RANK[membership['role']] ?? 0;
  const requiredRank = ROLE_RANK[minRole];
  return memberRank >= requiredRank;
}
