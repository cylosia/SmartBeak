/**
 * P2 TEST: Webhook Processing Flow Integration Tests
 * 
 * Tests complete webhook processing including signature verification,
 * idempotency, event handling, and error recovery.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import crypto from 'crypto';
import { handlePaddleWebhook } from '../../src/billing/paddleWebhook';
import handler from '../../../web/pages/api/webhooks/clerk';
import type { NextApiRequest, NextApiResponse } from 'next';

// Mock dependencies
vi.mock('../../src/db', () => ({
  getDb: vi.fn(),
}));

vi.mock('@kernel/redis', () => ({
  getRedis: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  }),
}));

describe('Webhook Processing Flow Integration Tests', () => {
  let mockDb: any;

  // P3-2 FIX: Store original env vars to restore after each test
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.clearAllMocks();

    // P3-2 FIX: Save env vars that tests may modify
    originalEnv['PADDLE_WEBHOOK_SECRET'] = process.env.PADDLE_WEBHOOK_SECRET;
    originalEnv['CLERK_WEBHOOK_SECRET'] = process.env.CLERK_WEBHOOK_SECRET;

    mockDb = {
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(1),
      insert: vi.fn().mockResolvedValue([1]),
      from: vi.fn().mockReturnThis(),
      count: vi.fn().mockReturnThis(),
    };

    const { getDb } = require('../../src/db');
    (getDb as any).mockResolvedValue(mockDb);
  });

  // P3-2 FIX: Restore env vars after each test to prevent pollution
  afterEach(() => {
    for (const [key, value] of Object.entries(originalEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe('Paddle Webhook Flow', () => {
    const calculatePaddleSignature = (payload: string, secret: string): string => {
      return crypto
        .createHmac('sha256', secret)
        .update(Buffer.from(payload))
        .digest('hex');
    };

    it('should process complete subscription lifecycle', async () => {
      process.env.PADDLE_WEBHOOK_SECRET = 'paddle-secret';
      
      // 1. Subscription created
      const createdPayload = JSON.stringify({
        event_type: 'subscription.created',
        org_id: 'org-test-123',
        subscription_id: 'sub-456',
        customer: { id: 'cus-789', email: 'test@example.com' },
      });
      
      const createdSignature = calculatePaddleSignature(
        createdPayload,
        process.env.PADDLE_WEBHOOK_SECRET
      );

      await handlePaddleWebhook(
        Buffer.from(createdPayload),
        createdSignature,
        'event-created-123'
      );

      expect(mockDb.update).toHaveBeenCalledWith({
        plan: 'pro',
        plan_status: 'active',
      });

      // 2. Subscription updated
      mockDb.update.mockClear();
      const updatedPayload = JSON.stringify({
        event_type: 'subscription.updated',
        org_id: 'org-test-123',
        subscription_id: 'sub-456',
        status: 'active',
      });
      
      const updatedSignature = calculatePaddleSignature(
        updatedPayload,
        process.env.PADDLE_WEBHOOK_SECRET
      );

      await handlePaddleWebhook(
        Buffer.from(updatedPayload),
        updatedSignature,
        'event-updated-456'
      );

      expect(mockDb.update).toHaveBeenCalled();

      // 3. Subscription cancelled
      mockDb.update.mockClear();
      mockDb.first.mockResolvedValue({ count: '0' });
      
      const cancelledPayload = JSON.stringify({
        event_type: 'subscription.cancelled',
        org_id: 'org-test-123',
        subscription_id: 'sub-456',
      });
      
      const cancelledSignature = calculatePaddleSignature(
        cancelledPayload,
        process.env.PADDLE_WEBHOOK_SECRET
      );

      await handlePaddleWebhook(
        Buffer.from(cancelledPayload),
        cancelledSignature,
        'event-cancelled-789'
      );

      expect(mockDb.update).toHaveBeenCalledWith({
        plan_status: 'cancelled',
      });
    });

    it('should handle webhook replay attack', async () => {
      process.env.PADDLE_WEBHOOK_SECRET = 'paddle-secret';
      
      const { getRedis } = await import('@kernel/redis');
      const mockRedis = {
        get: vi.fn().mockResolvedValue('1'), // Already processed
        setex: vi.fn().mockResolvedValue('OK'),
      };
      (getRedis as any).mockResolvedValue(mockRedis);

      const payload = JSON.stringify({
        event_type: 'subscription.created',
        org_id: 'org-test-123',
      });
      
      const signature = calculatePaddleSignature(
        payload,
        process.env.PADDLE_WEBHOOK_SECRET
      );

      // Process duplicate event
      await handlePaddleWebhook(
        Buffer.from(payload),
        signature,
        'duplicate-event-id'
      );

      // Should not process duplicate
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should handle invalid signature', async () => {
      process.env.PADDLE_WEBHOOK_SECRET = 'paddle-secret';
      
      const payload = JSON.stringify({
        event_type: 'subscription.created',
        org_id: 'org-test-123',
      });

      await expect(
        handlePaddleWebhook(
          Buffer.from(payload),
          'invalid-signature',
          'event-123'
        )
      ).rejects.toThrow('Invalid Paddle signature');
    });
  });

  describe('Clerk Webhook Flow', () => {
    const calculateSvixSignature = (
      secret: string,
      payload: string,
      timestamp: string,
      messageId: string
    ): string => {
      const signedContent = `${messageId}.${timestamp}.${payload}`;
      const secretBytes = secret.startsWith('whsec_')
        ? Buffer.from(secret.slice(6), 'base64')
        : Buffer.from(secret, 'base64');
      
      return crypto
        .createHmac('sha256', secretBytes)
        .update(signedContent)
        .digest('base64');
    };

    const createMockRequest = (
      body: object,
      headers: Record<string, string>,
      method = 'POST'
    ): Partial<NextApiRequest> => {
      const bodyString = JSON.stringify(body);
      
      return {
        method,
        headers: {
          'svix-id': headers['svix-id'] || 'msg-test',
          'svix-timestamp': headers['svix-timestamp'] || String(Math.floor(Date.now() / 1000)),
          'svix-signature': headers['svix-signature'] || 'v1,invalid',
        },
        on: vi.fn().mockImplementation((event: string, callback: any) => {
          if (event === 'data') {
            callback(Buffer.from(bodyString));
          }
          if (event === 'end') {
            callback();
          }
          return {};
        }),
      };
    };

    // P3-1 FIX: Moved `res` declaration before return to fix scoping bug.
    // Previously `let res: any` was declared after `return`, making it always undefined.
    const createMockResponse = () => {
      const jsonData: any = {};
      const statusCode: { value?: number } = {};

      const res: any = {
        status: vi.fn().mockImplementation((code: number) => {
          statusCode.value = code;
          return res;
        }),
        json: vi.fn().mockImplementation((data: any) => {
          Object.assign(jsonData, data);
          return res;
        }),
        _jsonData: jsonData,
        _statusCode: statusCode,
      };

      return res;
    };

    it('should process user lifecycle webhooks', async () => {
      process.env.CLERK_WEBHOOK_SECRET = 'whsec_test_secret';
      
      const timestamp = String(Math.floor(Date.now() / 1000));
      const messageId = 'msg-user-lifecycle';

      // 1. User created
      const createdBody = {
        data: {
          id: 'user-test-123',
          email_addresses: [{ email_address: 'test@example.com' }],
          first_name: 'Test',
          last_name: 'User',
        },
        object: 'event',
        type: 'user.created',
      };

      const createdSignature = calculateSvixSignature(
        process.env.CLERK_WEBHOOK_SECRET,
        JSON.stringify(createdBody),
        timestamp,
        messageId
      );

      const req1 = createMockRequest(createdBody, {
        'svix-id': messageId,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${createdSignature}`,
      });
      const res1 = createMockResponse() as any;

      await handler(req1 as NextApiRequest, res1 as NextApiResponse);
      expect(res1._statusCode.value).toBe(200);

      // 2. User updated
      const updatedBody = {
        data: {
          id: 'user-test-123',
          email_addresses: [{ email_address: 'updated@example.com' }],
          first_name: 'Updated',
          last_name: 'Name',
        },
        object: 'event',
        type: 'user.updated',
      };

      const updatedSignature = calculateSvixSignature(
        process.env.CLERK_WEBHOOK_SECRET,
        JSON.stringify(updatedBody),
        timestamp,
        messageId + '-update'
      );

      const req2 = createMockRequest(updatedBody, {
        'svix-id': messageId + '-update',
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${updatedSignature}`,
      });
      const res2 = createMockResponse() as any;

      await handler(req2 as NextApiRequest, res2 as NextApiResponse);
      expect(res2._statusCode.value).toBe(200);
    });

    it('should handle organization membership changes', async () => {
      process.env.CLERK_WEBHOOK_SECRET = 'whsec_test_secret';
      
      const timestamp = String(Math.floor(Date.now() / 1000));
      const messageId = 'msg-org-membership';

      const membershipBody = {
        data: {
          id: 'user-test-123',
          organization_id: 'org-test-456',
          role: 'admin',
        },
        object: 'event',
        type: 'organizationMembership.created',
      };

      const signature = calculateSvixSignature(
        process.env.CLERK_WEBHOOK_SECRET,
        JSON.stringify(membershipBody),
        timestamp,
        messageId
      );

      const req = createMockRequest(membershipBody, {
        'svix-id': messageId,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${signature}`,
      });
      const res = createMockResponse() as any;

      await handler(req as NextApiRequest, res as NextApiResponse);
      
      expect(res._statusCode.value).toBe(200);
      expect(res._jsonData).toMatchObject({
        received: true,
        event: 'organizationMembership.created',
      });
    });

    it('should detect and handle replay attacks', async () => {
      process.env.CLERK_WEBHOOK_SECRET = 'whsec_test_secret';
      
      const { getRedis } = await import('@kernel/redis');
      const mockRedis = {
        get: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce('1'), // First null, then found
        setex: vi.fn().mockResolvedValue('OK'),
      };
      (getRedis as any).mockResolvedValue(mockRedis);

      const timestamp = String(Math.floor(Date.now() / 1000));
      const messageId = 'msg-replay-test';

      const body = {
        data: { id: 'user-test-123' },
        object: 'event',
        type: 'user.created',
      };

      const signature = calculateSvixSignature(
        process.env.CLERK_WEBHOOK_SECRET,
        JSON.stringify(body),
        timestamp,
        messageId
      );

      const req = createMockRequest(body, {
        'svix-id': messageId,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${signature}`,
      });
      const res = createMockResponse() as any;

      await handler(req as NextApiRequest, res as NextApiResponse);
      
      // Should mark event as processed
      expect(mockRedis.setex).toHaveBeenCalled();
    });
  });

  describe('Webhook Error Recovery', () => {
    it('should handle database errors gracefully', async () => {
      process.env.PADDLE_WEBHOOK_SECRET = 'paddle-secret';
      
      mockDb.update.mockRejectedValue(new Error('Database connection lost'));

      const payload = JSON.stringify({
        event_type: 'subscription.created',
        org_id: 'org-test-123',
        subscription_id: 'sub-456',
      });

      const signature = crypto
        .createHmac('sha256', process.env.PADDLE_WEBHOOK_SECRET)
        .update(Buffer.from(payload))
        .digest('hex');

      // Should throw error to trigger webhook retry
      await expect(
        handlePaddleWebhook(Buffer.from(payload), signature, 'event-123')
      ).rejects.toThrow();
    });

    it('should handle malformed webhook payloads', async () => {
      process.env.CLERK_WEBHOOK_SECRET = 'whsec_test_secret';
      
      const req = {
        method: 'POST',
        headers: {
          'svix-id': 'msg-test',
          'svix-timestamp': String(Math.floor(Date.now() / 1000)),
          'svix-signature': 'v1,invalid',
        },
        on: vi.fn().mockImplementation((event: string, callback: any) => {
          if (event === 'data') {
            callback(Buffer.from('invalid json here'));
          }
          if (event === 'end') {
            callback();
          }
          return {};
        }),
      };
      const res = createMockResponse() as any;

      await handler(req as unknown as NextApiRequest, res as NextApiResponse);
      
      expect(res._statusCode.value).toBe(401); // Invalid signature
    });
  });
});
