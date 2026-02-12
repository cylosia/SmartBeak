/**
 * T1: Clerk Webhook Signature Verification Tests
 *
 * Validates that the webhook handler:
 * 1. Uses crypto.timingSafeEqual (not ===) for signature comparison
 * 2. Accepts valid HMAC signatures
 * 3. Rejects tampered/invalid signatures
 * 4. Enforces timestamp bounds (replay attack prevention)
 * 5. Handles multi-signature headers and malformed base64
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import crypto from 'crypto';
import handler from '../clerk';
import type { NextApiRequest, NextApiResponse } from 'next';

// Mock environment
process.env.CLERK_WEBHOOK_SECRET = 'whsec_dGVzdHNlY3JldGtleWZvcnRlc3Rpbmc=';
process.env.REDIS_URL = 'redis://localhost:6379';

// Mock Redis to isolate signature tests from dedup logic
vi.mock('@kernel/redis', () => ({
  getRedis: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  }),
}));

// Mock ioredis
vi.mock('ioredis', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
    on: vi.fn(),
  })),
}));

// Mock db imports to prevent actual DB calls
vi.mock('../../../../lib/db', () => ({
  withTransaction: vi.fn(async (fn: any) => {
    const mockTrx = {
      query: vi.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
    };
    return fn(mockTrx);
  }),
  getDb: vi.fn().mockResolvedValue({
    where: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockReturnThis(),
    onConflict: vi.fn().mockReturnThis(),
    merge: vi.fn().mockResolvedValue(undefined),
    ignore: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(1),
  }),
}));

// Mock requireEnv
vi.mock('../../../../lib/env', () => ({
  requireEnv: vi.fn((key: string) => {
    if (key === 'CLERK_WEBHOOK_SECRET') return process.env.CLERK_WEBHOOK_SECRET;
    throw new Error(`Missing env: ${key}`);
  }),
}));

describe('Clerk Webhook Signature Verification (T1)', () => {
  let mockRes: Partial<NextApiResponse>;
  let jsonResponse: any;
  let statusCode: number;
  let timingSafeEqualSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonResponse = null;
    statusCode = 0;

    mockRes = {
      status: vi.fn().mockImplementation((code: number) => {
        statusCode = code;
        return mockRes;
      }),
      json: vi.fn().mockImplementation((data: any) => {
        jsonResponse = data;
        return mockRes;
      }),
    };

    // Spy on timingSafeEqual before each test
    timingSafeEqualSpy = vi.spyOn(crypto, 'timingSafeEqual');
  });

  afterEach(() => {
    timingSafeEqualSpy.mockRestore();
  });

  /**
   * Helper to compute Svix signature
   */
  function calculateSvixSignature(
    secret: string,
    payload: string,
    timestamp: string,
    messageId: string
  ): string {
    const signedContent = `${messageId}.${timestamp}.${payload}`;
    const secretBytes = secret.startsWith('whsec_')
      ? Buffer.from(secret.slice(6), 'base64')
      : Buffer.from(secret, 'base64');

    return crypto
      .createHmac('sha256', secretBytes)
      .update(signedContent)
      .digest('base64');
  }

  /**
   * Helper to create a mock NextApiRequest
   */
  function createMockRequest(
    body: object,
    headers: Record<string, string> = {},
    method = 'POST'
  ): Partial<NextApiRequest> {
    const bodyString = JSON.stringify(body);

    return {
      method,
      headers: {
        'content-type': 'application/json',
        ...headers,
      },
      on: vi.fn().mockImplementation((event: string, callback: any) => {
        if (event === 'data') {
          callback(Buffer.from(bodyString));
        }
        if (event === 'end') {
          callback();
        }
        return {} as any;
      }),
    };
  }

  /**
   * Helper to create a valid webhook request
   */
  function createValidWebhookRequest(
    event: object,
    overrides: {
      messageId?: string;
      timestamp?: string;
      signaturePrefix?: string;
    } = {}
  ) {
    const payload = JSON.stringify(event);
    const messageId = overrides.messageId || `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timestamp = overrides.timestamp || String(Math.floor(Date.now() / 1000));
    const secret = process.env.CLERK_WEBHOOK_SECRET!;
    const sig = calculateSvixSignature(secret, payload, timestamp, messageId);
    const prefix = overrides.signaturePrefix || 'v1';

    return createMockRequest(event, {
      'svix-id': messageId,
      'svix-timestamp': timestamp,
      'svix-signature': `${prefix},${sig}`,
    });
  }

  const validEvent = {
    data: { id: 'user_test_sig_123', email_addresses: [{ email_address: 'sig@test.com' }] },
    object: 'event' as const,
    type: 'user.created',
  };

  // -------------------------------------------------------------------------
  // Test 1: Valid signature accepted
  // -------------------------------------------------------------------------
  it('should accept a valid HMAC signature', async () => {
    const req = createValidWebhookRequest(validEvent);
    await handler(req as NextApiRequest, mockRes as NextApiResponse);
    expect(statusCode).toBe(200);
    expect(jsonResponse).toMatchObject({ received: true, event: 'user.created' });
  });

  // -------------------------------------------------------------------------
  // Test 2: Invalid signature rejected
  // -------------------------------------------------------------------------
  it('should reject an invalid signature', async () => {
    const payload = JSON.stringify(validEvent);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const messageId = 'msg-invalid-sig';

    const req = createMockRequest(validEvent, {
      'svix-id': messageId,
      'svix-timestamp': timestamp,
      'svix-signature': 'v1,aW52YWxpZHNpZ25hdHVyZQ==', // "invalidsignature" in base64
    });

    await handler(req as NextApiRequest, mockRes as NextApiResponse);
    expect(statusCode).toBe(401);
    expect(jsonResponse).toEqual({ error: 'Invalid webhook signature' });
  });

  // -------------------------------------------------------------------------
  // Test 3: Tampered payload with original signature rejected
  // -------------------------------------------------------------------------
  it('should reject a tampered payload (signature from different body)', async () => {
    const originalPayload = JSON.stringify(validEvent);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const messageId = 'msg-tampered';
    const secret = process.env.CLERK_WEBHOOK_SECRET!;

    // Compute signature for original payload
    const sig = calculateSvixSignature(secret, originalPayload, timestamp, messageId);

    // Send a different payload with the signature from the original
    const tamperedEvent = {
      data: { id: 'user_attacker', email_addresses: [{ email_address: 'evil@attacker.com' }] },
      object: 'event' as const,
      type: 'user.created',
    };

    const req = createMockRequest(tamperedEvent, {
      'svix-id': messageId,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,${sig}`,
    });

    await handler(req as NextApiRequest, mockRes as NextApiResponse);
    expect(statusCode).toBe(401);
    expect(jsonResponse).toEqual({ error: 'Invalid webhook signature' });
  });

  // -------------------------------------------------------------------------
  // Test 4: crypto.timingSafeEqual is used (timing attack prevention)
  // -------------------------------------------------------------------------
  it('should use crypto.timingSafeEqual for signature comparison', async () => {
    const req = createValidWebhookRequest(validEvent);
    await handler(req as NextApiRequest, mockRes as NextApiResponse);

    // Verify timingSafeEqual was called (not ===)
    expect(timingSafeEqualSpy).toHaveBeenCalled();

    // Verify it was called with Buffer arguments
    const firstCall = timingSafeEqualSpy.mock.calls[0];
    expect(firstCall).toBeDefined();
    expect(Buffer.isBuffer(firstCall![0])).toBe(true);
    expect(Buffer.isBuffer(firstCall![1])).toBe(true);
  });

  // -------------------------------------------------------------------------
  // Test 5: Expired timestamp (>5 min old) rejected
  // -------------------------------------------------------------------------
  it('should reject timestamps older than 5 minutes', async () => {
    const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400); // ~6.7 minutes ago

    const event = { ...validEvent };
    const payload = JSON.stringify(event);
    const messageId = 'msg-old-ts';
    const secret = process.env.CLERK_WEBHOOK_SECRET!;
    const sig = calculateSvixSignature(secret, payload, oldTimestamp, messageId);

    const req = createMockRequest(event, {
      'svix-id': messageId,
      'svix-timestamp': oldTimestamp,
      'svix-signature': `v1,${sig}`,
    });

    await handler(req as NextApiRequest, mockRes as NextApiResponse);
    expect(statusCode).toBe(401);
    expect(jsonResponse).toEqual({ error: 'Invalid webhook signature' });
  });

  // -------------------------------------------------------------------------
  // Test 6: Future timestamp (>30s ahead) rejected
  // -------------------------------------------------------------------------
  it('should reject timestamps more than 30 seconds in the future', async () => {
    const futureTimestamp = String(Math.floor(Date.now() / 1000) + 60); // 60s in future

    const event = { ...validEvent };
    const payload = JSON.stringify(event);
    const messageId = 'msg-future-ts';
    const secret = process.env.CLERK_WEBHOOK_SECRET!;
    const sig = calculateSvixSignature(secret, payload, futureTimestamp, messageId);

    const req = createMockRequest(event, {
      'svix-id': messageId,
      'svix-timestamp': futureTimestamp,
      'svix-signature': `v1,${sig}`,
    });

    await handler(req as NextApiRequest, mockRes as NextApiResponse);
    expect(statusCode).toBe(401);
    expect(jsonResponse).toEqual({ error: 'Invalid webhook signature' });
  });

  // -------------------------------------------------------------------------
  // Test 7: Multiple signatures — first invalid, second valid — passes
  // -------------------------------------------------------------------------
  it('should accept when one of multiple signatures is valid', async () => {
    const payload = JSON.stringify(validEvent);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const messageId = `msg-multi-${Date.now()}`;
    const secret = process.env.CLERK_WEBHOOK_SECRET!;
    const validSig = calculateSvixSignature(secret, payload, timestamp, messageId);

    // Svix sends space-separated signatures: "v1,invalid v1,valid"
    const req = createMockRequest(validEvent, {
      'svix-id': messageId,
      'svix-timestamp': timestamp,
      'svix-signature': `v1,aW52YWxpZHNpZw== v1,${validSig}`,
    });

    await handler(req as NextApiRequest, mockRes as NextApiResponse);
    expect(statusCode).toBe(200);
    expect(jsonResponse).toMatchObject({ received: true });
  });

  // -------------------------------------------------------------------------
  // Test 8: Malformed base64 in signature doesn't crash
  // -------------------------------------------------------------------------
  it('should not crash on malformed base64 in signature', async () => {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const messageId = 'msg-malformed';

    const req = createMockRequest(validEvent, {
      'svix-id': messageId,
      'svix-timestamp': timestamp,
      'svix-signature': 'v1,!!!not-base64!!!',
    });

    await handler(req as NextApiRequest, mockRes as NextApiResponse);
    // Should reject gracefully, not throw
    expect(statusCode).toBe(401);
    expect(jsonResponse).toEqual({ error: 'Invalid webhook signature' });
  });

  // -------------------------------------------------------------------------
  // Test 9: Missing svix headers returns 400
  // -------------------------------------------------------------------------
  it('should return 400 when svix headers are missing', async () => {
    const req = createMockRequest(validEvent, {});
    await handler(req as NextApiRequest, mockRes as NextApiResponse);
    expect(statusCode).toBe(400);
    expect(jsonResponse).toEqual({ error: 'Missing required Svix headers' });
  });
});
