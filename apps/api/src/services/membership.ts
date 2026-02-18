/**
 * P2-FIX (P2-8): Extracted verifyOrgMembership into a shared service.
 *
 * Previously, four billing route files (billingStripe.ts, billingPaddle.ts,
 * billingInvoiceExport.ts, billingInvoices.ts) each contained an identical
 * local copy of this function. Any change to org membership logic (e.g. role-
 * based access, multi-tenancy) must be applied exactly once here.
 */

import { getDb } from '../db';

/**
 * Verify that a user is an active member of an organization.
 * @returns true if a membership row exists, false otherwise.
 */
export async function verifyOrgMembership(userId: string, orgId: string): Promise<boolean> {
  const db = await getDb();
  const membership = await db('org_memberships')
    .where({ user_id: userId, org_id: orgId })
    .first();
  return !!membership;
}
