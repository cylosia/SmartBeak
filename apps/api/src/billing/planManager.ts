import { getDb } from '../db';

/**
 * Schedule a plan downgrade for an organization
 * @param orgId - Organization ID
 * @param nextPlan - Plan to downgrade to
 * @returns Promise that resolves when downgrade is scheduled
 */
export async function scheduleDowngrade(
  orgId: string,
  nextPlan: string
): Promise<void> {
  const db = await getDb();

  await db.transaction(async (trx) => {
  await trx('orgs')
    .where({ id: orgId })
    .update({
    plan_next: nextPlan,
    plan_status: 'downgrading'
    });

  await trx('audit_events').insert({
    org_id: orgId,
    actor_type: 'user',
    action: 'billing_downgrade_scheduled',
    metadata: JSON.stringify({ nextPlan })
  });
  });
}

/**
 * Apply a proration credit to an organization
 * @param orgId - Organization ID
 * @param amount - Proration amount
 * @returns Promise that resolves when proration is recorded
 */
export async function applyProration(orgId: string, amount: number): Promise<void> {
  const db = await getDb();
  await db('billing_prorations').insert({
    org_id: orgId,
    amount,
    created_at: new Date(),
  });
}
