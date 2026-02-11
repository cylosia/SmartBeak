/**
 * P0-CRITICAL TESTS: Stripe Integration
 * 
 * Tests payment processing that handles:
 * - Checkout session creation
 * - Idempotency
 * - Webhook processing
 * 
 * Security-critical: Tests idempotency to prevent double-charges.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  createStripeCheckoutSession,
  handleStripeWebhook,
} from '../stripe';

// Mock Stripe
const mockStripeSessionsCreate = vi.fn();
vi.mock('stripe', () => ({
  default: vi.fn().mockImplementation(() => ({
    checkout: {
      sessions: {
        create: mockStripeSessionsCreate,
      },
    },
  })),
}));

describe('Stripe Integration - P0 Critical Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.STRIPE_SECRET_KEY = 'sk_test_123';
    process.env.APP_URL = 'https://test.example.com';
  });

  describe('Checkout Session Creation', () => {
    it('should create checkout session with valid parameters', async () => {
      mockStripeSessionsCreate.mockResolvedValue({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/test',
      });

      const result = await createStripeCheckoutSession('org_123', 'price_123');

      expect(result.id).toBe('cs_test_123');
      expect(result.url).toBe('https://checkout.stripe.com/test');
    });

    it('P0-FIX: should use cryptographically secure idempotency key', async () => {
      // P0-FIX: Previously used Date.now() which could collide within same millisecond
      mockStripeSessionsCreate.mockResolvedValue({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/test',
      });

      await createStripeCheckoutSession('org_123', 'price_123');

      const callArgs = mockStripeSessionsCreate.mock.calls[0];
      const options = callArgs[1];
      const idempotencyKey = options.idempotencyKey;

      // Idempotency key should:
      // 1. Include org and price
      expect(idempotencyKey).toContain('org_123');
      expect(idempotencyKey).toContain('price_123');
      
      // 2. Use UUID format (not timestamp)
      // UUID pattern: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
      const uuidPattern = /^checkout_org_123_price_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      expect(idempotencyKey).toMatch(uuidPattern);
    });

    it('P0-FIX: should pass idempotency key to Stripe API', async () => {
      mockStripeSessionsCreate.mockResolvedValue({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/test',
      });

      await createStripeCheckoutSession('org_123', 'price_123');

      // Verify idempotencyKey is passed to Stripe
      const callArgs = mockStripeSessionsCreate.mock.calls[0];
      expect(callArgs[1]).toHaveProperty('idempotencyKey');
      expect(callArgs[1].idempotencyKey).toBeTruthy();
    });

    it('should validate orgId format', async () => {
      await expect(
        createStripeCheckoutSession('', 'price_123')
      ).rejects.toThrow('Invalid orgId');
    });

    it('should validate priceId format', async () => {
      await expect(
        createStripeCheckoutSession('org_123', 'invalid_price')
      ).rejects.toThrow('Invalid priceId');
    });

    it('should include metadata with orgId', async () => {
      mockStripeSessionsCreate.mockResolvedValue({
        id: 'cs_test_123',
        url: 'https://checkout.stripe.com/test',
      });

      await createStripeCheckoutSession('org_123', 'price_123');

      const callArgs = mockStripeSessionsCreate.mock.calls[0];
      const params = callArgs[0];
      
      expect(params.metadata).toMatchObject({ orgId: 'org_123' });
      expect(params.client_reference_id).toBe('org_123');
    });

    it('should retry on transient errors', async () => {
      // First two calls fail, third succeeds
      mockStripeSessionsCreate
        .mockRejectedValueOnce(new Error('Connection refused'))
        .mockRejectedValueOnce(new Error('Timeout'))
        .mockResolvedValue({
          id: 'cs_test_123',
          url: 'https://checkout.stripe.com/test',
        });

      const result = await createStripeCheckoutSession('org_123', 'price_123');

      expect(result.id).toBe('cs_test_123');
      expect(mockStripeSessionsCreate).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries exceeded', async () => {
      mockStripeSessionsCreate.mockRejectedValue(new Error('Persistent error'));

      await expect(
        createStripeCheckoutSession('org_123', 'price_123')
      ).rejects.toThrow('createCheckoutSession failed after 3 attempts');

      expect(mockStripeSessionsCreate).toHaveBeenCalledTimes(3);
    });
  });

  describe('Webhook Handling', () => {
    it('should handle checkout.session.completed', async () => {
      const event = {
        type: 'checkout.session.completed',
        data: {
          object: {
            id: 'cs_test_123',
            customer: 'cus_test',
            metadata: { orgId: 'org_123' },
          },
        },
      };

      // Should not throw
      await expect(handleStripeWebhook(event as any)).resolves.not.toThrow();
    });

    it('should handle invoice.payment_failed', async () => {
      const event = {
        type: 'invoice.payment_failed',
        data: {
          object: {
            id: 'inv_test_123',
            customer: 'cus_test',
            attempt_count: 3,
          },
        },
      };

      await expect(handleStripeWebhook(event as any)).resolves.not.toThrow();
    });

    it('should handle customer.subscription.deleted', async () => {
      const event = {
        type: 'customer.subscription.deleted',
        data: {
          object: {
            id: 'sub_test_123',
            customer: 'cus_test',
            status: 'canceled',
          },
        },
      };

      await expect(handleStripeWebhook(event as any)).resolves.not.toThrow();
    });

    it('should skip unhandled event types gracefully', async () => {
      const event = {
        type: 'unhandled.event.type',
        data: { object: {} },
      };

      await expect(handleStripeWebhook(event as any)).resolves.not.toThrow();
    });

    it('should handle invalid event', async () => {
      await expect(handleStripeWebhook(null as any)).resolves.not.toThrow();
      await expect(handleStripeWebhook({} as any)).resolves.not.toThrow();
    });
  });
});
