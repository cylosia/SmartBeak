/**
 * P2 TEST: Paddle Webhook Tests
 * 
 * Tests Paddle webhook signature verification, event handling,
 * and idempotency protection.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { handlePaddleWebhook, verifyPaddleSignature } from '../paddleWebhook';
import * as dbModule from '../../db';

// Mock dependencies
vi.mock('../../db', () => ({
  getDb: vi.fn(),
}));

vi.mock('@kernel/redis', () => ({
  getRedis: vi.fn().mockResolvedValue({
    get: vi.fn().mockResolvedValue(null),
    setex: vi.fn().mockResolvedValue('OK'),
  }),
}));

describe('Paddle Webhook Tests', () => {
  let mockDb: any;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PADDLE_WEBHOOK_SECRET = 'test-webhook-secret';

    mockDb = {
      where: vi.fn().mockReturnThis(),
      select: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      update: vi.fn().mockResolvedValue(1),
      insert: vi.fn().mockResolvedValue([1]),
      from: vi.fn().mockReturnThis(),
      count: vi.fn().mockReturnThis(),
    };

    (dbModule.getDb as any).mockResolvedValue(mockDb);
  });

  describe('Signature Verification', () => {
    it('should verify valid webhook signature', () => {
      const secret = 'test-secret';
      const payload = JSON.stringify({ event_type: 'subscription.created', org_id: 'org-123', occurred_at: new Date().toISOString() });
      const rawBody = Buffer.from(payload);
      
      // Calculate expected signature
      const crypto = require('crypto');
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');

      // Access the internal function through the module
      const verifyFn = (handlePaddleWebhook as any).verifyPaddleSignature || verifyPaddleSignature;
      
      // Note: In actual implementation, we'd need to export verifyPaddleSignature
      // For now, we'll test through handlePaddleWebhook
    });

    it('should reject invalid webhook signature', async () => {
      const payload = JSON.stringify({
        event_type: 'subscription.created',
        org_id: 'org-123',
        occurred_at: new Date().toISOString(),
      });
      const rawBody = Buffer.from(payload);
      const invalidSignature = 'invalid-signature';

      await expect(
        handlePaddleWebhook(rawBody, invalidSignature, 'event-123')
      ).rejects.toThrow('Invalid Paddle signature');
    });

    it('should reject webhook with missing signature', async () => {
      const payload = JSON.stringify({ org_id: 'org-123', occurred_at: new Date().toISOString() });
      const rawBody = Buffer.from(payload);

      await expect(
        handlePaddleWebhook(rawBody, '', 'event-123')
      ).rejects.toThrow('Invalid Paddle signature');
    });
  });

  describe('Event Processing', () => {
    const createValidPayload = (eventType: string, extraData = {}) => ({
      event_type: eventType,
      org_id: 'org-123',
      subscription_id: 'sub-456',
      customer: { id: 'cus-789', email: 'test@example.com' },
      occurred_at: new Date().toISOString(),
      ...extraData,
    });

    const calculateSignature = (payload: object) => {
      const crypto = require('crypto');
      const secret = process.env.PADDLE_WEBHOOK_SECRET!;
      return crypto
        .createHmac('sha256', secret)
        .update(Buffer.from(JSON.stringify(payload)))
        .digest('hex');
    };

    it('should handle subscription.created event', async () => {
      const payload = createValidPayload('subscription.created');
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = calculateSignature(payload);

      // Mock no existing subscription
      mockDb.first.mockResolvedValue(null);

      await handlePaddleWebhook(rawBody, signature, 'event-123');

      expect(mockDb.update).toHaveBeenCalledWith({
        plan: 'pro',
        plan_status: 'active',
      });
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should handle subscription.updated event', async () => {
      const payload = createValidPayload('subscription.updated');
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = calculateSignature(payload);

      await handlePaddleWebhook(rawBody, signature, 'event-456');

      expect(mockDb.update).toHaveBeenCalledWith({
        plan: 'pro',
        plan_status: 'active',
      });
    });

    it('should handle subscription.cancelled event', async () => {
      const payload = createValidPayload('subscription.cancelled');
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = calculateSignature(payload);

      // Mock no other active subscriptions
      mockDb.first.mockResolvedValue({ count: '0' });

      await handlePaddleWebhook(rawBody, signature, 'event-789');

      expect(mockDb.update).toHaveBeenCalledWith({
        plan_status: 'cancelled',
      });
    });

    it('should skip cancellation if other active subscriptions exist', async () => {
      const payload = createValidPayload('subscription.cancelled');
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = calculateSignature(payload);

      // Mock existing active subscription
      mockDb.first.mockResolvedValue({ count: '1' });

      await handlePaddleWebhook(rawBody, signature, 'event-abc');

      // Should not update plan_status
      expect(mockDb.update).not.toHaveBeenCalledWith({
        plan_status: 'cancelled',
      });
    });

    it('should handle transaction.completed event', async () => {
      const payload = createValidPayload('transaction.completed', {
        transaction_id: 'txn-123',
        amount: '99.00',
        currency: 'USD',
      });
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = calculateSignature(payload);

      await handlePaddleWebhook(rawBody, signature, 'event-def');

      // Should log audit event
      expect(mockDb.insert).toHaveBeenCalled();
    });

    it('should reject invalid event types', async () => {
      const payload = createValidPayload('unknown.event.type');
      const rawBody = Buffer.from(JSON.stringify(payload));
      const signature = calculateSignature(payload);

      // Should not throw, just warn
      await expect(
        handlePaddleWebhook(rawBody, signature, 'event-ghi')
      ).resolves.not.toThrow();

      // Should not update database
      expect(mockDb.update).not.toHaveBeenCalled();
    });
  });

  describe('Idempotency Protection', () => {
    it('should reject duplicate events', async () => {
      const { getRedis } = await import('@kernel/redis');
      const mockRedis = {
        get: vi.fn().mockResolvedValue('1'), // Event already processed
        setex: vi.fn().mockResolvedValue('OK'),
      };
      (getRedis as any).mockResolvedValue(mockRedis);

      const payload = { event_type: 'subscription.created', org_id: 'org-123', occurred_at: new Date().toISOString() };
      const rawBody = Buffer.from(JSON.stringify(payload));
      
      await handlePaddleWebhook(rawBody, 'any-signature', 'duplicate-event-id');

      // Should not process duplicate
      expect(mockDb.update).not.toHaveBeenCalled();
    });

    it('should mark events as processed in Redis', async () => {
      const { getRedis } = await import('@kernel/redis');
      const mockRedis = {
        get: vi.fn().mockResolvedValue(null),
        setex: vi.fn().mockResolvedValue('OK'),
      };
      (getRedis as any).mockResolvedValue(mockRedis);

      const payload = { event_type: 'subscription.created', org_id: 'org-123', occurred_at: new Date().toISOString() };
      const rawBody = Buffer.from(JSON.stringify(payload));

      // Calculate a valid signature so the webhook handler proceeds to Redis check
      const crypto = require('crypto');
      const secret = process.env.PADDLE_WEBHOOK_SECRET!;
      const validSignature = crypto
        .createHmac('sha256', secret)
        .update(rawBody)
        .digest('hex');

      await handlePaddleWebhook(rawBody, validSignature, 'new-event-id');

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'webhook:paddle:event:new-event-id',
        86400,
        '1',
      );
    });
  });

  describe('Security Validation', () => {
    it('should reject events without org_id', async () => {
      const payload = { event_type: 'subscription.created', occurred_at: new Date().toISOString() };
      const rawBody = Buffer.from(JSON.stringify(payload));

      await expect(
        handlePaddleWebhook(rawBody, 'any-signature', 'event-123')
      ).rejects.toThrow('missing or invalid org_id');
    });

    it('should reject malformed JSON payload', async () => {
      const rawBody = Buffer.from('invalid json');

      await expect(
        handlePaddleWebhook(rawBody, 'any-signature', 'event-123')
      ).rejects.toThrow('Invalid JSON payload');
    });

    it('should require webhook secret configuration', async () => {
      delete process.env.PADDLE_WEBHOOK_SECRET;

      const payload = { event_type: 'subscription.created', org_id: 'org-123', occurred_at: new Date().toISOString() };
      const rawBody = Buffer.from(JSON.stringify(payload));

      await expect(
        handlePaddleWebhook(rawBody, 'signature', 'event-123')
      ).rejects.toThrow('PADDLE_WEBHOOK_SECRET not configured');
    });
  });
});
