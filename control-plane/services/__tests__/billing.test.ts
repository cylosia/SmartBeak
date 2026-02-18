/**
 * H1 TEST: BillingService unit tests
 *
 * Covers assignPlan, cancelSubscription, getActivePlan, enterGrace,
 * idempotency, compensation, and rollback paths.
 * Required coverage: ≥90% branches / lines (billing path mandate).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { Pool, PoolClient, QueryResult } from 'pg';

import { BillingService } from '../billing';
import type { PaymentGateway, CreateCustomerResult, CreateSubscriptionResult } from '../stripe';

// ---------------------------------------------------------------------------
// Mock @kernel/redis
// ---------------------------------------------------------------------------
const mockRedis = {
  get: vi.fn(),
  set: vi.fn(),   // required by tryClaimProcessing: redis.set(key, value, 'EX', ttl, 'NX')
  setex: vi.fn(),
  del: vi.fn(),
  ttl: vi.fn(),
};
vi.mock('@kernel/redis', () => ({
  getRedis: vi.fn().mockResolvedValue(mockRedis),
}));

// ---------------------------------------------------------------------------
// Mock @kernel/logger (suppress output in test runs)
// ---------------------------------------------------------------------------
vi.mock('@kernel/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeQueryResult<T>(rows: T[], rowCount = rows.length): QueryResult<T> {
  return { rows, rowCount, command: '', oid: 0, fields: [] } as unknown as QueryResult<T>;
}

function makePoolClient(queryMap: Record<string, QueryResult>): PoolClient {
  const client = {
    query: vi.fn(async (sql: string, _params?: unknown[]) => {
      // Match first word of query (SELECT, INSERT, UPDATE, BEGIN, etc.)
      const key = Object.keys(queryMap).find(k => sql.includes(k));
      return key ? queryMap[key] : makeQueryResult([]);
    }),
    release: vi.fn(),
  } as unknown as PoolClient;
  return client;
}

function makePool(client: PoolClient, directQueryResult?: QueryResult): Pool {
  return {
    connect: vi.fn().mockResolvedValue(client),
    query: vi.fn().mockResolvedValue(directQueryResult ?? makeQueryResult([])),
  } as unknown as Pool;
}

function makeGateway(overrides: Partial<PaymentGateway> = {}): PaymentGateway {
  return {
    createCustomer: vi.fn<[], Promise<CreateCustomerResult>>().mockResolvedValue({ customerId: 'cus_test' }),
    createSubscription: vi.fn<[], Promise<CreateSubscriptionResult>>().mockResolvedValue({ subscriptionId: 'sub_test' }),
    cancelSubscription: vi.fn<[], Promise<boolean>>().mockResolvedValue(true),
    deleteCustomer: vi.fn<[], Promise<boolean>>().mockResolvedValue(true),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BillingService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRedis.get.mockResolvedValue(null);      // No idempotency record by default
    mockRedis.set.mockResolvedValue('OK');      // NX succeeds by default (fresh key)
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.del.mockResolvedValue(1);
    mockRedis.ttl.mockResolvedValue(3600);
  });

  // =========================================================================
  // Constructor validation
  // =========================================================================

  describe('constructor', () => {
    it('throws when pool is missing', () => {
      expect(() => new BillingService(null as unknown as Pool)).toThrow('Database pool is required');
    });
  });

  // =========================================================================
  // assignPlan
  // =========================================================================

  describe('assignPlan', () => {
    it('throws for invalid orgId', async () => {
      const svc = new BillingService(makePool(makePoolClient({})));
      await expect(svc.assignPlan('', 'plan-pro')).rejects.toThrow('Valid orgId');
    });

    it('throws for invalid planId', async () => {
      const svc = new BillingService(makePool(makePoolClient({})));
      await expect(svc.assignPlan('org-1', '')).rejects.toThrow('Valid planId');
    });

    it('assigns plan successfully on happy path', async () => {
      const plan = { id: 'plan-pro', name: 'Pro', price_cents: 999, interval: 'monthly', features: [] };
      const client = makePoolClient({
        'BEGIN': makeQueryResult([]),
        'SET LOCAL': makeQueryResult([]),
        'SELECT * FROM plans': makeQueryResult([plan]),
        'SELECT stripe_subscription_id FROM subscriptions': makeQueryResult([]), // no existing sub
        'INSERT INTO subscriptions': makeQueryResult([]),
        'COMMIT': makeQueryResult([]),
      });
      const pool = makePool(client);
      const gateway = makeGateway();
      const svc = new BillingService(pool, gateway);

      await svc.assignPlan('org-1', 'plan-pro');

      expect(gateway.createCustomer).toHaveBeenCalledWith('org-1');
      expect(gateway.createSubscription).toHaveBeenCalledWith('cus_test', 'plan-pro');
      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('idempotency:billing:'),
        3600,
        expect.stringContaining('"status":"completed"'),
      );
    });

    it('returns early on idempotent retry (status=completed)', async () => {
      // Simulate: NX fails (key exists), GET returns completed entry
      mockRedis.set.mockResolvedValue(null); // NX fails — key already owned
      mockRedis.get.mockResolvedValue(JSON.stringify({ status: 'completed', result: { subscriptionId: 'sub_old' } }));
      const gateway = makeGateway();
      const svc = new BillingService(makePool(makePoolClient({})), gateway);

      await svc.assignPlan('org-1', 'plan-pro'); // Should return without calling Stripe

      expect(gateway.createCustomer).not.toHaveBeenCalled();
    });

    it('throws on idempotent retry with status=processing (still in progress)', async () => {
      // Simulate: NX fails (key exists), GET returns in-progress entry within timeout
      mockRedis.set.mockResolvedValue(null); // NX fails
      mockRedis.get.mockResolvedValue(JSON.stringify({
        status: 'processing',
        startedAt: Date.now() - 1000, // 1 second ago — well within 5-minute timeout
      }));
      const svc = new BillingService(makePool(makePoolClient({})));

      await expect(svc.assignPlan('org-1', 'plan-pro')).rejects.toThrow('still in progress');
    });

    it('throws when processing entry has timed out (manual retry required)', async () => {
      // tryClaimProcessing throws 'Previous operation timed out — please retry' when
      // a processing entry's startedAt exceeds the 5-minute PROCESSING_TIMEOUT_MS.
      // The caller must retry; there is no automatic re-claim.
      const FIVE_MIN_MS = 5 * 60 * 1000;
      mockRedis.set.mockResolvedValue(null); // NX fails — key exists
      mockRedis.get.mockResolvedValue(JSON.stringify({
        status: 'processing',
        startedAt: Date.now() - FIVE_MIN_MS - 1000, // timed out
      }));
      const svc = new BillingService(makePool(makePoolClient({})));

      await expect(svc.assignPlan('org-1', 'plan-pro'))
        .rejects.toThrow('Previous operation timed out');
    });

    it('throws and compensates when plan not found', async () => {
      const client = makePoolClient({
        'BEGIN': makeQueryResult([]),
        'SET LOCAL': makeQueryResult([]),
        'SELECT * FROM plans': makeQueryResult([]), // empty → plan not found
        'ROLLBACK': makeQueryResult([]),
      });
      const gateway = makeGateway();
      const svc = new BillingService(makePool(client), gateway);

      await expect(svc.assignPlan('org-1', 'no-such-plan')).rejects.toThrow('Plan not found');
      expect(gateway.cancelSubscription).not.toHaveBeenCalled(); // no sub was created
      expect(gateway.deleteCustomer).not.toHaveBeenCalled();
    });

    it('throws when org already has active subscription', async () => {
      const plan = { id: 'plan-pro', name: 'Pro', price_cents: 999, interval: 'monthly', features: [] };
      const client = makePoolClient({
        'BEGIN': makeQueryResult([]),
        'SET LOCAL': makeQueryResult([]),
        'SELECT * FROM plans': makeQueryResult([plan]),
        'SELECT stripe_subscription_id FROM subscriptions': makeQueryResult([{ stripe_subscription_id: 'sub_existing' }]),
        'ROLLBACK': makeQueryResult([]),
      });
      const svc = new BillingService(makePool(client), makeGateway());

      await expect(svc.assignPlan('org-1', 'plan-pro')).rejects.toThrow('already has an active subscription');
    });

    it('compensates Stripe when DB insert fails', async () => {
      const plan = { id: 'plan-pro', name: 'Pro', price_cents: 999, interval: 'monthly', features: [] };
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce(makeQueryResult([]))       // BEGIN
          .mockResolvedValueOnce(makeQueryResult([]))       // SET LOCAL
          .mockResolvedValueOnce(makeQueryResult([plan]))   // SELECT plan
          .mockResolvedValueOnce(makeQueryResult([]))       // SELECT existing sub
          // createCustomer and createSubscription happen here (gateway calls)
          .mockRejectedValueOnce(new Error('DB insert failed')) // INSERT fails
          .mockResolvedValueOnce(makeQueryResult([])),          // ROLLBACK
        release: vi.fn(),
      } as unknown as PoolClient;

      const gateway = makeGateway();
      const svc = new BillingService(makePool(client), gateway);

      await expect(svc.assignPlan('org-1', 'plan-pro')).rejects.toThrow('Failed to assign plan');
      expect(gateway.cancelSubscription).toHaveBeenCalledWith('sub_test');
      expect(gateway.deleteCustomer).toHaveBeenCalledWith('cus_test');
    });

    it('stores failed status in idempotency key on error', async () => {
      const client = makePoolClient({
        'BEGIN': makeQueryResult([]),
        'SET LOCAL': makeQueryResult([]),
        'SELECT * FROM plans': makeQueryResult([]), // plan not found
        'ROLLBACK': makeQueryResult([]),
      });
      const svc = new BillingService(makePool(client), makeGateway());

      await expect(svc.assignPlan('org-1', 'plan-missing')).rejects.toThrow();
      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringContaining('idempotency:billing:'),
        3600,
        expect.stringContaining('"status":"failed"'),
      );
    });

    it('handles corrupted idempotency record by failing safe (no double-charge)', async () => {
      // When SET NX fails (key exists) but GET returns unparseable JSON,
      // tryClaimProcessing returns { claimed: false } with no existingEntry.
      // assignPlan treats this as a concurrent-operation guard and throws rather
      // than risk processing twice. This is correct fail-safe behaviour.
      mockRedis.set.mockResolvedValue(null);          // NX fails — key exists
      mockRedis.get.mockResolvedValue('not-valid-json{{'); // corrupted payload
      const svc = new BillingService(makePool(makePoolClient({})));

      await expect(svc.assignPlan('org-1', 'plan-pro'))
        .rejects.toThrow('Concurrent operation in progress');
    });
  });

  // =========================================================================
  // cancelSubscription
  // =========================================================================

  describe('cancelSubscription', () => {
    it('throws for invalid orgId', async () => {
      const svc = new BillingService(makePool(makePoolClient({})));
      await expect(svc.cancelSubscription('')).rejects.toThrow('Valid orgId');
    });

    it('throws when no active subscription found', async () => {
      const client = makePoolClient({
        'BEGIN': makeQueryResult([]),
        'SET LOCAL': makeQueryResult([]),
        'SELECT id, stripe_subscription_id': makeQueryResult([]), // no active sub
        'ROLLBACK': makeQueryResult([]),
      });
      const svc = new BillingService(makePool(client));

      await expect(svc.cancelSubscription('org-1')).rejects.toThrow('No active subscription');
    });

    it('cancels subscription via Stripe and updates DB', async () => {
      const sub = { id: 'db-sub-1', stripe_subscription_id: 'sub_stripe', stripe_customer_id: 'cus_c' };
      const client = makePoolClient({
        'BEGIN': makeQueryResult([]),
        'SET LOCAL': makeQueryResult([]),
        'SELECT id, stripe_subscription_id': makeQueryResult([sub]),
        'UPDATE subscriptions': makeQueryResult([], 1),
        'COMMIT': makeQueryResult([]),
      });
      const gateway = makeGateway();
      const svc = new BillingService(makePool(client), gateway);

      await svc.cancelSubscription('org-1');

      expect(gateway.cancelSubscription).toHaveBeenCalledWith('sub_stripe');
    });

    it('rolls back on error and re-throws', async () => {
      const sub = { id: 'db-sub-1', stripe_subscription_id: 'sub_stripe', stripe_customer_id: 'cus_c' };
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce(makeQueryResult([]))   // BEGIN
          .mockResolvedValueOnce(makeQueryResult([]))   // SET LOCAL
          .mockResolvedValueOnce(makeQueryResult([sub])) // SELECT
          // gateway.cancelSubscription called here (not mocked to fail)
          .mockRejectedValueOnce(new Error('DB update error'))  // UPDATE fails
          .mockResolvedValueOnce(makeQueryResult([])),          // ROLLBACK
        release: vi.fn(),
      } as unknown as PoolClient;
      const svc = new BillingService(makePool(client), makeGateway());

      await expect(svc.cancelSubscription('org-1')).rejects.toThrow('Failed to cancel');
    });
  });

  // =========================================================================
  // getActivePlan
  // =========================================================================

  describe('getActivePlan', () => {
    it('throws for invalid orgId', async () => {
      const svc = new BillingService(makePool(makePoolClient({})));
      await expect(svc.getActivePlan('')).rejects.toThrow('Valid orgId');
    });

    it('returns null when no active plan', async () => {
      const pool = makePool(makePoolClient({}), makeQueryResult([]));
      const svc = new BillingService(pool);

      const result = await svc.getActivePlan('org-1');
      expect(result).toBeNull();
    });

    it('returns plan data when found', async () => {
      const planRow = {
        id: 'plan-pro', name: 'Pro', price_cents: 999, interval: 'monthly',
        features: [], subscription_id: 'sub-1', subscription_status: 'active',
      };
      const pool = makePool(makePoolClient({}), makeQueryResult([planRow]));
      const svc = new BillingService(pool);

      const result = await svc.getActivePlan('org-1');
      expect(result?.['id']).toBe('plan-pro');
    });

    it('propagates DB errors with descriptive message', async () => {
      const pool = {
        connect: vi.fn(),
        query: vi.fn().mockRejectedValue(new Error('connection refused')),
      } as unknown as Pool;
      const svc = new BillingService(pool);

      await expect(svc.getActivePlan('org-1')).rejects.toThrow('Failed to fetch active plan');
    });
  });

  // =========================================================================
  // enterGrace
  // =========================================================================

  describe('enterGrace', () => {
    it('throws for invalid orgId', async () => {
      const svc = new BillingService(makePool(makePoolClient({})));
      await expect(svc.enterGrace('')).rejects.toThrow('Valid orgId');
    });

    it('throws for non-integer days', async () => {
      const svc = new BillingService(makePool(makePoolClient({})));
      await expect(svc.enterGrace('org-1', 1.5)).rejects.toThrow('positive integer');
    });

    it('throws when no active subscription found', async () => {
      const client = makePoolClient({
        'BEGIN': makeQueryResult([]),
        'SET LOCAL': makeQueryResult([]),
        'UPDATE subscriptions': makeQueryResult([], 0), // rowCount=0 → no active sub
        'ROLLBACK': makeQueryResult([]),
      });
      const svc = new BillingService(makePool(client));

      await expect(svc.enterGrace('org-1')).rejects.toThrow('No active subscription');
    });

    it('enters grace period successfully', async () => {
      const client = makePoolClient({
        'BEGIN': makeQueryResult([]),
        'SET LOCAL': makeQueryResult([]),
        'UPDATE subscriptions': makeQueryResult([], 1), // rowCount=1 → updated
        'COMMIT': makeQueryResult([]),
      });
      const svc = new BillingService(makePool(client));

      await svc.enterGrace('org-1', 14);
      expect(client.query).toHaveBeenCalledWith('COMMIT');
    });
  });

  // =========================================================================
  // Compensation
  // =========================================================================

  describe('compensateStripe', () => {
    it('does not throw even if Stripe compensation fails', async () => {
      const gateway = makeGateway({
        cancelSubscription: vi.fn().mockRejectedValue(new Error('Stripe down')),
        deleteCustomer: vi.fn().mockRejectedValue(new Error('Stripe down')),
      });

      const plan = { id: 'plan-pro', name: 'Pro', price_cents: 999, interval: 'monthly', features: [] };
      const client = {
        query: vi.fn()
          .mockResolvedValueOnce(makeQueryResult([]))       // BEGIN
          .mockResolvedValueOnce(makeQueryResult([]))       // SET LOCAL
          .mockResolvedValueOnce(makeQueryResult([plan]))   // SELECT plan
          .mockResolvedValueOnce(makeQueryResult([]))       // SELECT existing sub
          .mockRejectedValueOnce(new Error('DB insert failed')) // INSERT fails
          .mockResolvedValueOnce(makeQueryResult([])),          // ROLLBACK
        release: vi.fn(),
      } as unknown as PoolClient;

      const svc = new BillingService(makePool(client), gateway);

      // Even though compensation fails, the original error should still propagate
      await expect(svc.assignPlan('org-1', 'plan-pro')).rejects.toThrow('Failed to assign plan');
    });
  });
});
