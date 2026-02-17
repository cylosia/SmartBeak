
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

import { getLogger } from '@kernel/logger';
import { getRedis } from '@kernel/redis';
import { AppError, ValidationError, NotFoundError, ConflictError, ServiceUnavailableError, DatabaseError, ErrorCodes } from '@errors';

import { StripeAdapter } from './stripe';

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
    private stripe = new StripeAdapter()
  ) {
    if (!pool) {
    throw new ServiceUnavailableError('Database pool is required');
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
    throw new ValidationError('Valid orgId (string) is required');
    }
    if (!planId || typeof planId !== 'string') {
    throw new ValidationError('Valid planId (string) is required');
    }

    const key = idempotencyKey || this.generateIdempotencyKey(orgId, `assignPlan:${planId}`);

    const idempotencyCheck = await this.checkIdempotency(key);
    if (idempotencyCheck.exists) {
    if (idempotencyCheck["error"]) {
        throw new ConflictError(idempotencyCheck["error"]);
    }
    logger.info('Idempotent retry detected', { orgId });
    return;
    }

    await this.setIdempotencyStatus(key, 'processing');

    const client = await this.pool.connect();
    let stripeCustomerId: string | undefined;
    let stripeSubscriptionId: string | undefined;

    try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [60000]);

    const planResult = await client.query<Plan>(
        'SELECT * FROM plans WHERE id = $1',
        [planId]
    );

    if (planResult.rows.length === 0) {
        throw new NotFoundError('Plan');
    }

    const existingSub = await client.query(
        'SELECT stripe_subscription_id FROM subscriptions WHERE org_id = $1 AND status = $2',
        [orgId, 'active']
    );

    if (existingSub.rows.length > 0) {
        throw new ConflictError('Organization already has an active subscription');
    }

    const { customerId } = await this.stripe.createCustomer(orgId);
    stripeCustomerId = customerId;

    const { subscriptionId } = await this.stripe.createSubscription(customerId, planId);
    stripeSubscriptionId = subscriptionId;

    const dbSubscriptionId = randomUUID();
    await client.query(
        `INSERT INTO subscriptions (id, org_id, plan_id, status, stripe_customer_id, stripe_subscription_id, created_at, updated_at)
        VALUES ($1, $2, $3, 'active', $4, $5, NOW(), NOW())`,
        [dbSubscriptionId, orgId, planId, customerId, subscriptionId]
    );

    await client.query('COMMIT');
    await this.setIdempotencyStatus(key, 'completed', { subscriptionId });

    await this.auditLog('subscription_created', orgId, { planId, subscriptionId });

    logger.info(`Assigned plan ${planId} to org ${orgId}`);
    } catch (error) {
    await client.query('ROLLBACK');

    await this.compensateStripe(stripeCustomerId, stripeSubscriptionId);

    const errorMessage = error instanceof Error ? error.message : String(error);
    await this.setIdempotencyStatus(key, 'failed', undefined, errorMessage);

    logger.error('Error assigning plan', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof AppError) throw error;
    throw DatabaseError.fromDBError(error instanceof Error ? error : new Error(String(error)));
    } finally {
    client.release();
    }
  }

  async getActivePlan(orgId: string): Promise<ActivePlanResult | null> {
    if (!orgId || typeof orgId !== 'string') {
    throw new ValidationError('Valid orgId (string) is required');
    }

    try {
    const { rows } = await this.pool.query<ActivePlanResult>(
        `SELECT p.*, s.id as subscription_id, s.status as subscription_status
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
    if (error instanceof AppError) throw error;
    throw DatabaseError.fromDBError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  async enterGrace(orgId: string, days = 7): Promise<void> {
    if (!orgId || typeof orgId !== 'string') {
    throw new ValidationError('Valid orgId (string) is required');
    }
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1) {
    throw new ValidationError('days must be a positive integer');
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
        throw new NotFoundError('Subscription');
    }

    await this.auditLog('grace_period_entered', orgId, { days });

    await client.query('COMMIT');

    logger.info(`Entered grace period for org ${orgId}: ${days} days`);
    } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error entering grace period', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof AppError) throw error;
    throw DatabaseError.fromDBError(error instanceof Error ? error : new Error(String(error)));
    } finally {
    client.release();
    }
  }

  async cancelSubscription(orgId: string): Promise<void> {
    if (!orgId || typeof orgId !== 'string') {
    throw new ValidationError('Valid orgId (string) is required');
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
        throw new NotFoundError('Subscription');
    }

    const subscription = rows[0];
    if (!subscription) {
        throw new NotFoundError('Subscription');
    }

    if (subscription['stripe_subscription_id']) {
        await this.stripe.cancelSubscription(subscription['stripe_subscription_id']);
    }

    await client.query(
        `UPDATE subscriptions
        SET status = 'cancelled',
            cancelled_at = NOW(),
            updated_at = NOW()
        WHERE id = $1`,
        [subscription['id']]
    );

    await this.auditLog('subscription_cancelled', orgId, { subscriptionId: subscription['id'] });

    await client.query('COMMIT');

    logger.info(`Cancelled subscription for org ${orgId}`);
    } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error cancelling subscription', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof AppError) throw error;
    throw DatabaseError.fromDBError(error instanceof Error ? error : new Error(String(error)));
    } finally {
    client.release();
    }
  }

  async updateSubscriptionStatus(subscriptionId: string, status: string): Promise<void> {
    if (!subscriptionId || typeof subscriptionId !== 'string') {
    throw new ValidationError('Valid subscriptionId (string) is required');
    }
    if (!status || typeof status !== 'string') {
    throw new ValidationError('Valid status (string) is required');
    }

    const validStatuses = ['active', 'cancelled', 'past_due', 'unpaid', 'trialing', 'paused'];
    if (!validStatuses.includes(status)) {
    throw new ValidationError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
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
        throw new NotFoundError('Subscription');
    }

    await this.auditLog('subscription_status_updated', subscriptionId, { status });

    await client.query('COMMIT');

    logger.info(`Updated subscription ${subscriptionId} status to ${status}`);
    } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Error updating subscription status', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof AppError) throw error;
    throw DatabaseError.fromDBError(error instanceof Error ? error : new Error(String(error)));
    } finally {
    client.release();
    }
  }

  async getSubscriptions(orgId: string): Promise<Subscription[]> {
    if (!orgId || typeof orgId !== 'string') {
    throw new ValidationError('Valid orgId (string) is required');
    }

    try {
    const { rows } = await this.pool.query<Subscription>(
        `SELECT * FROM subscriptions
        WHERE org_id = $1
        ORDER BY created_at DESC`,
        [orgId]
    );

    return rows;
    } catch (error) {
    logger.error('Error fetching subscriptions', error instanceof Error ? error : new Error(String(error)));
    if (error instanceof AppError) throw error;
    throw DatabaseError.fromDBError(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async auditLog(action: string, entityId: string, details: Record<string, unknown>): Promise<void> {
    logger.info(`[AUDIT][billing] ${action}`, { entityId, ...details, timestamp: new Date().toISOString() });
  }
}
