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

// FIX(P3-MEM-07): Use the canonical @database alias instead of a direct
// relative import from '../db'. The @database package owns connection pool
// management and health checks; bypassing it risks creating a second Knex
// instance with a separate pool, doubling connection counts.
import { getDb } from '@database';
import { DatabaseError } from '@errors';

const VALID_ROLES = ['owner', 'admin', 'editor', 'viewer'] as const;
type Role = typeof VALID_ROLES[number];

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
  // FIX(P0-MEM-01): getDb() is synchronous (returns Knex, not Promise<Knex>).
  // `await`ing a non-Promise is a no-op at runtime but is semantically wrong
  // and implies async DB initialisation that does not exist.
  const db = getDb();
  try {
    // P0-1 FIX: Use correct table name 'memberships' (not 'org_memberships')
    // FIX(P2-MEM-05): Select only the 'role' column instead of SELECT * —
    // fetching all columns loads potentially sensitive fields (invite_token,
    // payment_reference, etc.) into memory on every authorization check.
    const membership = await db('memberships')
      .select('role')
      .where({ user_id: userId, org_id: orgId })
      .first<{ role: string } | undefined>();

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
  } catch (err: unknown) {
    // FIX(P2-MEM-06): Wrap raw Knex errors in DatabaseError so callers get a
    // sanitized AppError subclass. Raw Knex errors can contain connection strings,
    // table names, and SQL fragments that must not reach HTTP responses.
    throw DatabaseError.fromDBError(err);
  }
}
