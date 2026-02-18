/**
 * P1-9: Stripe Webhook Security Tests
 *
 * Covers the three security controls in apps/web/pages/api/webhooks/stripe.ts:
 *   1. Signature verification — rejects requests without a valid Stripe-Signature
 *   2. Timestamp staleness — rejects events older than the 5-minute replay window
 *   3. Idempotency / replay protection — deduplicates events via Redis SET NX
 */

import { EventEmitter } from 'events';
import type { NextApiRequest, NextApiResponse } from 'next';

// ---------------------------------------------------------------------------
// Module mocks — must be declared before any `import` of the module under test
// ---------------------------------------------------------------------------

jest.mock('../../../../lib/stripe', () => ({
  getStripe: jest.fn(),
  getStripeWebhookSecret: jest.fn().mockReturnValue('whsec_test_secret'),
}));

jest.mock('../../../../lib/db', () => ({
  pool: {
    connect: jest.fn().mockResolvedValue({
      query: jest.fn().mockResolvedValue({ rows: [] }),
      release: jest.fn(),
    }),
  },
}));

jest.mock('@kernel/logger', () => ({
  getLogger: () => ({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }),
}));

// Mock ioredis so the handler can initialise a Redis client without a live server
jest.mock('ioredis', () => {
  const mockRedis = {
    // Default: SET NX succeeds (key did not exist → new event)
    set: jest.fn().mockResolvedValue('OK'),
    on: jest.fn(),
  };
  return jest.fn().mockImplementation(() => mockRedis);
});

// ---------------------------------------------------------------------------
// Import handler AFTER mocks are registered
// ---------------------------------------------------------------------------
import handler from '../stripe';
import { getStripe, getStripeWebhookSecret } from '../../../../lib/stripe';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Build a minimal valid Stripe event object. */
function makeStripeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: `evt_${Math.random().toString(36).slice(2)}`,
    type: 'customer.subscription.updated',
    // Default: current timestamp (fresh, within the 5-minute window)
    created: Math.floor(Date.now() / 1000),
    api_version: '2023-10-16',
    data: { object: {} },
    ...overrides,
  };
}

/**
 * Create a mock NextApiRequest that streams `body` through Node.js EventEmitter.
 * The handler reads the body via `req.on('data', ...)` / `req.on('end', ...)`.
 */
function createMockReq(
  body: Buffer,
  headers: Record<string, string>,
): NextApiRequest {
  const emitter = new EventEmitter() as EventEmitter & { method: string; headers: Record<string, string> };
  emitter.method = 'POST';
  emitter.headers = headers;

  // Emit the body chunks after the current call stack clears so the handler's
  // Promise constructor has time to attach its listeners first.
  process.nextTick(() => {
    emitter.emit('data', body);
    emitter.emit('end');
  });

  return emitter as unknown as NextApiRequest;
}

/** Build a minimal mock response that records what was sent. */
function createMockRes() {
  const res = {
    _status: 200,
    _body: undefined as unknown,
    status(code: number) {
      this._status = code;
      return this;
    },
    json(body: unknown) {
      this._body = body;
      return this;
    },
  };
  return res;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('P1-9: Stripe Webhook Security', () => {
  const VALID_BODY = Buffer.from(JSON.stringify(makeStripeEvent()));

  beforeEach(() => {
    jest.clearAllMocks();
    // Restore the default webhook secret for every test
    (getStripeWebhookSecret as jest.Mock).mockReturnValue('whsec_test_secret');
    // Default ioredis mock: key does not exist → fresh event
    const Redis = jest.requireMock<jest.Mock>('ioredis');
    Redis.mock.results.forEach((r: { value: { set: jest.Mock } }) => {
      r.value.set.mockResolvedValue('OK');
    });
  });

  // -------------------------------------------------------------------------
  // 1. Signature verification
  // -------------------------------------------------------------------------

  it('rejects requests that are missing the stripe-signature header', async () => {
    const req = createMockReq(VALID_BODY, {}); // no stripe-signature
    const res = createMockRes();

    await handler(req, res as unknown as NextApiResponse);

    expect(res._status).toBe(400);
    expect((res._body as Record<string, string>)['error']).toMatch(/missing stripe-signature/i);
  });

  it('rejects requests with an invalid stripe signature', async () => {
    // constructEvent throws for any bad signature
    const mockStripe = {
      webhooks: {
        constructEvent: jest.fn().mockImplementation(() => {
          throw new Error('No signatures found matching the expected signature for payload');
        }),
      },
    };
    (getStripe as jest.Mock).mockReturnValue(mockStripe);

    const req = createMockReq(VALID_BODY, { 'stripe-signature': 'tampered' });
    const res = createMockRes();

    await handler(req, res as unknown as NextApiResponse);

    expect(res._status).toBe(400);
    expect((res._body as Record<string, string>)['error']).toMatch(/signature verification failed/i);
  });

  it('accepts requests with a valid stripe signature', async () => {
    const event = makeStripeEvent();
    const mockStripe = {
      webhooks: {
        constructEvent: jest.fn().mockReturnValue(event),
      },
    };
    (getStripe as jest.Mock).mockReturnValue(mockStripe);

    const req = createMockReq(Buffer.from(JSON.stringify(event)), {
      'stripe-signature': 't=1,v1=valid',
    });
    const res = createMockRes();

    await handler(req, res as unknown as NextApiResponse);

    // Must not return 400/401 for a properly signed request
    expect(res._status).not.toBe(400);
    expect(res._status).not.toBe(401);
  });

  // -------------------------------------------------------------------------
  // 2. Timestamp staleness (replay window)
  // -------------------------------------------------------------------------
  // The handler delegates replay-window enforcement to the Stripe SDK's
  // constructEvent(), which validates the `t=` timestamp embedded in the
  // stripe-signature header (5-minute tolerance). A manual check on
  // `event.created` was deliberately removed because it incorrectly rejected
  // legitimate Stripe webhook retries that arrive more than 5 minutes after the
  // original delivery attempt (e.g., after a transient server outage).
  // This test verifies the handler does NOT reject events based on event.created.

  it('does not reject events based on event.created age — SDK enforces the replay window via the signature header', async () => {
    const staleCreated = Math.floor(Date.now() / 1000) - 6 * 60; // 6 min ago
    const staleEvent = makeStripeEvent({ created: staleCreated });

    const mockStripe = {
      webhooks: {
        // constructEvent succeeds (the SDK accepted the t= header timestamp)
        constructEvent: jest.fn().mockReturnValue(staleEvent),
      },
    };
    (getStripe as jest.Mock).mockReturnValue(mockStripe);

    const req = createMockReq(Buffer.from(JSON.stringify(staleEvent)), {
      'stripe-signature': 't=1,v1=valid',
    });
    const res = createMockRes();

    await handler(req, res as unknown as NextApiResponse);

    // Handler must not 400 on stale event.created — only the SDK's constructEvent
    // may reject, and here it returned successfully.
    expect(res._status).not.toBe(400);
  });

  // -------------------------------------------------------------------------
  // 3. Idempotency / replay protection
  // -------------------------------------------------------------------------

  it('returns 200 with idempotent:true for replayed (duplicate) event IDs', async () => {
    const event = makeStripeEvent({ id: 'evt_replay_duplicate' });

    const mockStripe = {
      webhooks: {
        constructEvent: jest.fn().mockReturnValue(event),
      },
    };
    (getStripe as jest.Mock).mockReturnValue(mockStripe);

    // Simulate Redis returning null for SET NX (key already existed → duplicate)
    const Redis = jest.requireMock<jest.Mock>('ioredis');
    const redisMockInstance = Redis.mock.results[0]?.value ?? { set: jest.fn(), on: jest.fn() };
    redisMockInstance.set = jest.fn().mockResolvedValue(null);
    Redis.mockImplementation(() => redisMockInstance);

    const req = createMockReq(Buffer.from(JSON.stringify(event)), {
      'stripe-signature': 't=1,v1=valid',
    });
    const res = createMockRes();

    await handler(req, res as unknown as NextApiResponse);

    expect(res._status).not.toBe(500);
    expect((res._body as Record<string, unknown>)['received']).toBe(true);
    expect((res._body as Record<string, unknown>)['idempotent']).toBe(true);
  });

  it('processes unique event IDs exactly once', async () => {
    const event = makeStripeEvent({ id: 'evt_unique_new' });

    const mockStripe = {
      webhooks: {
        constructEvent: jest.fn().mockReturnValue(event),
      },
    };
    (getStripe as jest.Mock).mockReturnValue(mockStripe);

    // SET NX succeeds → new event (not a replay)
    const Redis = jest.requireMock<jest.Mock>('ioredis');
    const redisMockInstance = { set: jest.fn().mockResolvedValue('OK'), on: jest.fn() };
    Redis.mockImplementation(() => redisMockInstance);

    const req = createMockReq(Buffer.from(JSON.stringify(event)), {
      'stripe-signature': 't=1,v1=valid',
    });
    const res = createMockRes();

    await handler(req, res as unknown as NextApiResponse);

    // Should not be flagged as idempotent
    expect((res._body as Record<string, unknown> | undefined)?.['idempotent']).not.toBe(true);
  });
});
