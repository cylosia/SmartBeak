
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

import { getLogger } from '@kernel/logger';
import { getRedis } from '@kernel/redis';

import { PaymentGateway, StubPaymentGateway } from './stripe';

const logger = getLogger('billing');

const IDEMPOTENCY_PREFIX = 'idempotency:billing:';
const IDEMPOTENCY_TTL_SECONDS = 3600; // 1 hour
const IDEMPOTENCY_PROCESSING_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface Plan {
  id: string;
  name: string;
  price_cents: number;
  interval: string;
  features: string[];
  max_domains?: number | undefined;
  max_content?: number | undefined;
}

export interface Subscription {
  id: string;
  org_id: string;
  plan_id: string;
  status: string;
  stripe_subscription_id?: string | undefined;
  stripe_customer_id?: string | undefined;
  created_at: Date;
  updated_at: Date;
  grace_until?: Date | undefined;
  cancelled_at?: Date | undefined;
}

export interface ActivePlanResult {
  id: string;
  name: string;
  price_cents: number;
  interval: string;
  features: string[];
  subscription_id: string;
  subscription_status: string;
  max_domains?: number | undefined;
  max_content?: number | undefined;
  max_media?: number | undefined;
}

export interface IdempotencyEntry {
  status: string;
  result?: unknown;
  error?: string;
  startedAt?: number;
}

/**
* Billing Service
*
* Manages subscription lifecycle, plan assignments, and Stripe integration.
* Provides idempotency, compensation logic for failed operations, and audit logging.
*
* @example
* ```typescript
* const billing = new BillingService(pool);
* await billing.assignPlan('org-123', 'plan-pro');
* ```
*/
export class BillingService {
  constructor(
    private pool: Pool,
    private stripe: PaymentGateway = new StubPaymentGateway()
  ) {
    if (!pool) {
    throw new Error('Database pool is required');
    }
  }

  // P0-FIX: Removed randomUUID() which made every key unique, defeating idempotency.
  // Key is now deterministic from (operation, orgId) so retries find the prior entry.
  private generateIdempotencyKey(orgId: string, operation: string): string {
    return `${operation}:${orgId}`;
  }

  private async checkIdempotency(key: string): Promise<{ exists: boolean; result?: unknown; error?: string }> {
    const redis = await getRedis();
    const data = await redis.get(`${IDEMPOTENCY_PREFIX}${key}`);
    if (!data) {
    return { exists: false };
    }
    let entry: IdempotencyEntry;
    try {
      entry = JSON.parse(data);
    } catch {
      logger.warn('Corrupted idempotency record, deleting and allowing retry', { key });
      await redis.del(`${IDEMPOTENCY_PREFIX}${key}`).catch(() => {});
      return { exists: false };
    }
    if (entry.status === 'processing') {
      const elapsed = Date.now() - (entry.startedAt ?? 0);
      if (elapsed < IDEMPOTENCY_PROCESSING_TIMEOUT_MS) {
        return { exists: true, error: 'Operation still in progress' };
      }
      logger.warn('Idempotency processing timeout exceeded, allowing retry', { key, elapsed });
      await redis.del(`${IDEMPOTENCY_PREFIX}${key}`);
      return { exists: false };
    }
    return {
      exists: true,
      ...(entry.result !== undefined ? { result: entry.result } : {}),
      ...(entry.error !== undefined ? { error: entry.error } : {}),
    };
  }

  private async setIdempotencyStatus(key: string, status: string, result?: unknown, error?: string): Promise<void> {
    const redis = await getRedis();
    const entry: IdempotencyEntry = {
      status,
      ...(result !== undefined ? { result } : {}),
      ...(error !== undefined ? { error } : {}),
    };
    if (status === 'processing') {
      entry.startedAt = Date.now();
    }
    await redis.setex(
      `${IDEMPOTENCY_PREFIX}${key}`,
      IDEMPOTENCY_TTL_SECONDS,
      JSON.stringify(entry)
    );
  }

  private async compensateStripe(customerId?: string, subscriptionId?: string): Promise<void> {
    try {
    if (subscriptionId) {
        await this.stripe.cancelSubscription(subscriptionId);
        logger.info(`Compensated: cancelled Stripe subscription ${subscriptionId}`);
    }
    if (customerId) {
        await this.stripe.deleteCustomer(customerId);
        logger.info(`Compensated: deleted Stripe customer ${customerId}`);
    }
    } catch (compError: unknown) {
    logger.error('Compensation failed', compError instanceof Error ? compError : new Error(String(compError)));
    }
  }

  async assignPlan(orgId: string, planId: string, idempotencyKey?: string): Promise<void> {
    if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId (string) is required');
    }
    if (!planId || typeof planId !== 'string') {
    throw new Error('Valid planId (string) is required');
    }

    const key = idempotencyKey || this.generateIdempotencyKey(orgId, `assignPlan:${planId}`);

    const idempotencyCheck = await this.checkIdempotency(key);
    if (idempotencyCheck.exists) {
    if (idempotencyCheck["error"]) {
        throw new Error(idempotencyCheck["error"]);
    }
    logger.info('Idempotent retry detected', { orgId });
    return;
    }

    await this.setIdempotencyStatus(key, 'processing');

    // P0-FIX: Validate plan and check for a pre-existing subscription BEFORE opening
    // a DB transaction or calling Stripe. This keeps external HTTP calls out of any
    // transaction boundary, eliminating connection-pool exhaustion when Stripe is slow.
    const { rows: planRows } = await this.pool.query<Plan>(
      `SELECT id, name, price_cents, interval, features, max_domains, max_content
       FROM plans WHERE id = $1`,
      [planId]
    );
    if (planRows.length === 0) {
      const errorMessage = `Plan not found: ${planId}`;
      await this.setIdempotencyStatus(key, 'failed', undefined, errorMessage);
      throw new Error(errorMessage);
    }

    const { rows: existingSubRows } = await this.pool.query(
      `SELECT id FROM subscriptions WHERE org_id = $1 AND status = $2 LIMIT 1`,
      [orgId, 'active']
    );
    if (existingSubRows.length > 0) {
      const errorMessage = 'Organization already has an active subscription';
      await this.setIdempotencyStatus(key, 'failed', undefined, errorMessage);
      throw new Error(errorMessage);
    }

    // P0-FIX: Stripe API calls are now OUTSIDE any DB transaction.
    // A slow or retried Stripe network call no longer holds a connection open.
    let stripeCustomerId: string | undefined;
    let stripeSubscriptionId: string | undefined;
    try {
      const { customerId } = await this.stripe.createCustomer(orgId);
      if (!customerId) throw new Error('Stripe customer creation returned no ID');
      stripeCustomerId = customerId;

      const { subscriptionId } = await this.stripe.createSubscription(customerId, planId);
      if (!subscriptionId) throw new Error('Stripe subscription creation returned no ID');
      stripeSubscriptionId = subscriptionId;
    } catch (stripeError) {
      await this.compensateStripe(stripeCustomerId, stripeSubscriptionId);
      const errorMessage = stripeError instanceof Error ? stripeError.message : String(stripeError);
      await this.setIdempotencyStatus(key, 'failed', undefined, errorMessage);
      logger.error('Stripe error during plan assignment', stripeError instanceof Error ? stripeError : new Error(String(stripeError)));
      throw new Error(`Failed to assign plan: ${errorMessage}`);
    }

    // Short DB transaction — only inserts, no external calls, no long waits.
    const client = await this.pool.connect();
    try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [10000]);

    // TOCTOU guard: re-check inside the transaction so a concurrent request that
    // raced past the pre-flight check above does not create a duplicate subscription.
    const { rows: recheckRows } = await client.query(
      `SELECT id FROM subscriptions WHERE org_id = $1 AND status = $2 LIMIT 1`,
      [orgId, 'active']
    );
    if (recheckRows.length > 0) {
      await client.query('ROLLBACK');
      await this.compensateStripe(stripeCustomerId, stripeSubscriptionId);
      const errorMessage = 'Organization already has an active subscription';
      await this.setIdempotencyStatus(key, 'failed', undefined, errorMessage);
      throw new Error(errorMessage);
    }

    const dbSubscriptionId = randomUUID();
    await client.query(
        `INSERT INTO subscriptions (id, org_id, plan_id, status, stripe_customer_id, stripe_subscription_id, created_at, updated_at)
        VALUES ($1, $2, $3, 'active', $4, $5, NOW(), NOW())`,
        [dbSubscriptionId, orgId, planId, stripeCustomerId, stripeSubscriptionId]
    );

    // P2-FIX: Persist audit event inside the same transaction — atomically committed
    // with the subscription row. Logger-only audit trails are ephemeral and violate
    // compliance requirements (SOC 2, PCI-DSS).
    await client.query(
      `INSERT INTO audit_events (id, org_id, actor_type, action, entity_type, entity_id, metadata, created_at)
       VALUES ($1, $2, 'service', 'subscription_created', 'subscription', $3, $4, NOW())`,
      [randomUUID(), orgId, dbSubscriptionId, JSON.stringify({ planId, stripeCustomerId, stripeSubscriptionId })]
    );

    await client.query('COMMIT');
    await this.setIdempotencyStatus(key, 'completed', { subscriptionId: dbSubscriptionId });
    logger.info(`Assigned plan ${planId} to org ${orgId}`);
    } catch (error) {
    await client.query('ROLLBACK');
    await this.compensateStripe(stripeCustomerId, stripeSubscriptionId);
    const errorMessage = error instanceof Error ? error.message : String(error);
    await this.setIdempotencyStatus(key, 'failed', undefined, errorMessage);
    logger.error('Error assigning plan', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to assign plan: ${errorMessage}`);
    } finally {
    client.release();
    }
  }

  async getActivePlan(orgId: string): Promise<ActivePlanResult | null> {
    if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId (string) is required');
    }

    try {
    // P2-FIX: Enumerate columns explicitly instead of SELECT *.
    const { rows } = await this.pool.query<ActivePlanResult>(
        `SELECT p.id, p.name, p.price_cents, p.interval, p.features,
                p.max_domains, p.max_content, p.max_media,
                s.id as subscription_id, s.status as subscription_status
        FROM subscriptions s
        JOIN plans p ON p.id = s.plan_id
        WHERE s.org_id = $1
        AND s.status = 'active'
        ORDER BY s.created_at DESC
        LIMIT 1`,
        [orgId]
    );

    return rows[0] || null;
    } catch (error) {
    logger.error('Error fetching active plan', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to fetch active plan: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async enterGrace(orgId: string, days = 7): Promise<void> {
    if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId (string) is required');
    }
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1) {
    throw new Error('days must be a positive integer');
    }

    const client = await this.pool.connect();

    try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]);

    const result = await client.query(
        `UPDATE subscriptions
        SET grace_until = NOW() + ($2 * INTERVAL '1 day'),
            updated_at = NOW()
        WHERE org_id = $1 AND status = 'active'`,
        [orgId, days]
    );

    if (result.rowCount === 0) {
        throw new Error('No active subscription found');
    }

    // P2-FIX: Audit event written INSIDE the transaction, BEFORE COMMIT.
    // Previously the audit call came before COMMIT, but it only wrote to the
    // logger — now it persists to the DB atomically with the grace-period update.
    await client.query(
      `INSERT INTO audit_events (id, org_id, actor_type, action, entity_type, entity_id, metadata, created_at)
       VALUES ($1, $2, 'service', 'grace_period_entered', 'subscription', NULL, $3, NOW())`,
      [randomUUID(), orgId, JSON.stringify({ days })]
    );

    await client.query('COMMIT');

    logger.info(`Entered grace period for org ${orgId}: ${days} days`);
    } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error entering grace period', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to enter grace period: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
    client.release();
    }
  }

  async cancelSubscription(orgId: string): Promise<void> {
    if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId (string) is required');
    }

    const client = await this.pool.connect();

    try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]);

    const { rows } = await client.query<Subscription>(
        `SELECT id, stripe_subscription_id, stripe_customer_id
        FROM subscriptions
        WHERE org_id = $1 AND status = 'active'
        LIMIT 1`,
        [orgId]
    );

    if (rows.length === 0) {
        throw new Error('No active subscription found');
    }

    const subscription = rows[0];
    if (!subscription) {
        throw new Error('No active subscription found');
    }

    // P0-FIX: Commit the DB status change BEFORE calling Stripe.
    // Old order (Stripe cancel → DB update) was irrecoverable on DB failure:
    // Stripe showed 'cancelled', DB still showed 'active', no retry possible.
    // New order: DB is the source of truth. If the post-commit Stripe call fails,
    // the subscription is already locked in our system; ops can retry Stripe manually.
    await client.query(
        `UPDATE subscriptions
        SET status = 'cancelled',
            cancelled_at = NOW(),
            updated_at = NOW()
        WHERE id = $1`,
        [subscription['id']]
    );

    // P2-FIX: Persist audit event to DB inside the transaction.
    await client.query(
      `INSERT INTO audit_events (id, org_id, actor_type, action, entity_type, entity_id, metadata, created_at)
       VALUES ($1, $2, 'service', 'subscription_cancelled', 'subscription', $3, $4, NOW())`,
      [randomUUID(), orgId, subscription['id'],
       JSON.stringify({ stripeSubscriptionId: subscription['stripe_subscription_id'] })]
    );

    await client.query('COMMIT');
    logger.info(`Cancelled subscription for org ${orgId}`);

    // Stripe cancellation fires AFTER commit. If this fails, the subscription is
    // correctly cancelled in our DB. Log at error level so ops can reconcile.
    if (subscription['stripe_subscription_id']) {
        try {
          await this.stripe.cancelSubscription(subscription['stripe_subscription_id']);
        } catch (stripeError) {
          logger.error(
            'STRIPE CANCEL FAILED AFTER DB COMMIT — manual Stripe reconciliation required',
            {
              orgId,
              subscriptionId: subscription['id'],
              stripeSubscriptionId: subscription['stripe_subscription_id'],
              error: stripeError instanceof Error ? stripeError.message : String(stripeError),
            }
          );
          // Do NOT rethrow — the subscription is correctly cancelled in our DB.
        }
    }
    } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error cancelling subscription', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to cancel subscription: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
    client.release();
    }
  }

  async updateSubscriptionStatus(subscriptionId: string, status: string): Promise<void> {
    if (!subscriptionId || typeof subscriptionId !== 'string') {
    throw new Error('Valid subscriptionId (string) is required');
    }
    if (!status || typeof status !== 'string') {
    throw new Error('Valid status (string) is required');
    }

    const validStatuses = ['active', 'cancelled', 'past_due', 'unpaid', 'trialing', 'paused'];
    if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }

    const client = await this.pool.connect();

    try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]);

    const result = await client.query(
        `UPDATE subscriptions
        SET status = $2, updated_at = NOW()
        WHERE id = $1`,
        [subscriptionId, status]
    );

    if (result.rowCount === 0) {
        throw new Error('Subscription not found');
    }

    await client.query(
      `INSERT INTO audit_events (id, org_id, actor_type, action, entity_type, entity_id, metadata, created_at)
       VALUES ($1, (SELECT org_id FROM subscriptions WHERE id = $2 LIMIT 1),
               'service', 'subscription_status_updated', 'subscription', $2, $3, NOW())`,
      [randomUUID(), subscriptionId, JSON.stringify({ status })]
    );

    await client.query('COMMIT');

    logger.info(`Updated subscription ${subscriptionId} status to ${status}`);
    } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error updating subscription status', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to update subscription status: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
    client.release();
    }
  }

  async getSubscriptions(orgId: string): Promise<Subscription[]> {
    if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId (string) is required');
    }

    try {
    // P2-FIX: Enumerate columns explicitly — SELECT * silently pulls in new columns
    // added to the table, breaking the typed Subscription interface contract.
    const { rows } = await this.pool.query<Subscription>(
        `SELECT id, org_id, plan_id, status, stripe_customer_id, stripe_subscription_id,
                created_at, updated_at, grace_until, cancelled_at
        FROM subscriptions
        WHERE org_id = $1
        ORDER BY created_at DESC`,
        [orgId]
    );

    return rows;
    } catch (error) {
    logger.error('Error fetching subscriptions', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to fetch subscriptions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

}
