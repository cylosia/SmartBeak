/**
 * P2-FIX (P2-8): Extracted verifyOrgMembership into a shared service.
 *
 * Previously, four billing route files each contained an identical
 * local copy of this function. Any change to org membership logic
 * must be applied exactly once here.
 *
 * P0-1 FIX: Table name corrected from 'org_memberships' to 'memberships'
 *           to match the actual schema defined in migrations.
 * P1-2 FIX: Added optional requiredRole parameter for role-based access control.
 */

import { getDb } from '../db';

const VALID_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
type Role = typeof VALID_ROLES[number];

// P1-FIX: Validate UUID format before hitting the DB.  Without this, a caller
// that passes a non-UUID string (e.g. an org slug, a JWT claim from a broken
// token library, or a path-traversal string such as "../other-org") would:
// a) Produce a DB row that can never match → silently return false (tolerable
//    in the happy path but means we don't distinguish "not a member" from
//    "caller passed garbage"), and
// b) Expose the Knex query builder to malformed input that could cause driver
//    errors or, in future, SQL-injection-adjacent bugs if parameterisation is
//    ever bypassed.
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidUUID(value: string): boolean {
  return UUID_REGEX.test(value);
}

// P1-2 FIX: Role hierarchy for minimum-role checks
const ROLE_HIERARCHY: Record<Role, number> = {
  owner: 4,
  admin: 3,
  editor: 2,
  viewer: 1,
};

/**
 * Verify that a user is an active member of an organization,
 * optionally requiring a minimum role level.
 *
 * @param userId - The user ID to check
 * @param orgId - The organization ID to check
 * @param requiredRole - Optional minimum role required (e.g. 'admin' means admin or owner)
 * @returns true if membership exists and meets role requirements, false otherwise.
 */
export async function verifyOrgMembership(
  userId: string,
  orgId: string,
  requiredRole?: Role
): Promise<boolean> {
  // P1-FIX: Reject malformed IDs early — a non-UUID string can never match a
  // proper UUID primary key, so skip the DB round-trip entirely and return
  // false. This also prevents leaking driver error messages to callers.
  if (!isValidUUID(userId) || !isValidUUID(orgId)) {
    return false;
  }

  // P2-FIX: getDb() is synchronous — `await` on a non-Promise is a no-op but
  // misleads readers into thinking this is an async I/O call.
  const db = getDb();
  // P0-1 FIX: Use correct table name 'memberships' (not 'org_memberships')
  const membership = await db('memberships')
    .where({ user_id: userId, org_id: orgId })
    .first();

  if (!membership) return false;

  // P1-2 FIX: Check role level if a minimum role is required
  if (requiredRole) {
    // FIX(P2): Validate the role from DB before casting — Knex first() returns
    // `any`, so membership['role'] is untyped. A corrupt/migrated row with an
    // unexpected value would silently pass or throw deep inside business logic.
    const rawRole = membership['role'];
    if (typeof rawRole !== 'string' || !VALID_ROLES.includes(rawRole as Role)) {
      return false;
    }
    const memberRole = rawRole as Role;
    const memberLevel = ROLE_HIERARCHY[memberRole] ?? 0;
    const requiredLevel = ROLE_HIERARCHY[requiredRole] ?? 0;
    return memberLevel >= requiredLevel;
  }

  return true;
}
