import { getDb } from '../db';

/**
 * Verify that a user is a member of the specified organization.
 * Shared across billing routes to avoid duplication.
 */
export async function verifyOrgMembership(userId: string, orgId: string): Promise<boolean> {
  const db = await getDb();
  const membership = await db('org_memberships')
    .where({ user_id: userId, org_id: orgId })
    .first();
  return !!membership;
}
