/**
 * Security Tests for Billing Routes
 * Tests P1 Fix: Billing routes missing org membership verification
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import Fastify from 'fastify';
import { billingInvoiceRoutes } from '../billingInvoices';
import { billingInvoiceExportRoutes } from '../billingInvoiceExport';
import { billingPaddleRoutes } from '../billingPaddle';
import { billingStripeRoutes } from '../billingStripe';
import { getDb } from '../../db';

// Mock dependencies
jest.mock('../../db');
jest.mock('@security/jwt');
jest.mock('@config', () => ({
  getBillingConfig: () => ({
    stripeSecretKey: 'sk_test_xxx',
    jwtKey: 'test-jwt-key-32-chars-long'
  })
}));
jest.mock('../../middleware/rateLimiter', () => ({
  apiRateLimit: () => (req: unknown, reply: unknown, done: () => void) => done(),
  rateLimitMiddleware: () => (req: unknown, reply: unknown, done: () => void) => done()
}));
jest.mock('../billing/paddle', () => ({
  createPaddleCheckout: jest.fn().mockResolvedValue({ url: 'https://checkout.paddle.com/test' })
}));
jest.mock('../billing/stripe', () => ({
  createStripeCheckoutSession: jest.fn().mockResolvedValue({ url: 'https://checkout.stripe.com/test' })
}));
jest.mock('@kernel/redis', () => ({
  getRedis: jest.fn().mockResolvedValue({
    get: jest.fn(),
    setex: jest.fn(),
    del: jest.fn()
  })
}));
jest.mock('../../middleware/csrf', () => ({
  generateCsrfToken: jest.fn().mockResolvedValue('csrf-token'),
  validateCsrfToken: jest.fn().mockResolvedValue(true),
  clearCsrfToken: jest.fn()
}));

import { verifyToken, extractAndVerifyToken, extractBearerToken } from '@security/jwt';

describe('Billing Routes Security Tests', () => {
  let app: ReturnType<typeof Fastify>;
  const mockMembershipDb = jest.fn();

  beforeEach(() => {
    app = Fastify();
    jest.clearAllMocks();
    
    // Setup membership mock
    mockMembershipDb.mockReturnValue({
      where: jest.fn().mockReturnValue({ first: jest.fn().mockResolvedValue({ id: 'membership-1' }) })
    });
    
    (getDb as jest.Mock).mockResolvedValue(mockMembershipDb);
    
    process.env.STRIPE_SECRET_KEY = 'sk_test_xxx';
  });

  describe('P1-FIX: Org Membership Verification - billingInvoices', () => {
    beforeEach(() => {
      // Mock successful JWT verification with org context
      (verifyToken as jest.Mock).mockReturnValue({
        sub: 'user-123',
        orgId: 'org-456',
        stripeCustomerId: 'cus_test'
      });
      (extractBearerToken as jest.Mock).mockReturnValue('valid-token');
    });

    it('should allow access when user is org member', async () => {
      await app.register(billingInvoiceRoutes);
      
      const response = await app.inject({
        method: 'GET',
        url: '/billing/invoices',
        headers: {
          authorization: 'Bearer valid-token'
        }
      });

      // Should verify membership
      expect(mockMembershipDb).toHaveBeenCalled();
      expect(response.statusCode).not.toBe(403);
    });

    it('should reject access when user is not org member', async () => {
      // Mock no membership found
      mockMembershipDb.mockReturnValue({
        where: jest.fn().mockReturnValue({ first: jest.fn().mockResolvedValue(null) })
      });

      await app.register(billingInvoiceRoutes);
      
      const response = await app.inject({
        method: 'GET',
        url: '/billing/invoices',
        headers: {
          authorization: 'Bearer valid-token'
        }
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('ORG_MEMBERSHIP_REQUIRED');
    });

    it('should skip membership check for user-level billing (no org)', async () => {
      (verifyToken as jest.Mock).mockReturnValue({
        sub: 'user-123',
        stripeCustomerId: 'cus_test'
        // No orgId
      });

      await app.register(billingInvoiceRoutes);
      
      const response = await app.inject({
        method: 'GET',
        url: '/billing/invoices',
        headers: {
          authorization: 'Bearer valid-token'
        }
      });

      // Should not check membership when no org context
      expect(response.statusCode).not.toBe(403);
    });
  });

  describe('P1-FIX: Org Membership Verification - billingInvoiceExport', () => {
    beforeEach(() => {
      // Mock JWT verification
      jest.spyOn(require('jsonwebtoken'), 'verify').mockReturnValue({
        sub: 'user-123',
        orgId: 'org-456',
        stripeCustomerId: 'cus_test'
      } as any);
    });

    it('should verify membership before export', async () => {
      await app.register(billingInvoiceExportRoutes);
      
      const response = await app.inject({
        method: 'GET',
        url: '/billing/invoices/export',
        headers: {
          authorization: 'Bearer valid-token'
        }
      });

      // Should attempt membership verification
      expect(mockMembershipDb).toHaveBeenCalled();
    });

    it('should reject export for non-members', async () => {
      mockMembershipDb.mockReturnValue({
        where: jest.fn().mockReturnValue({ first: jest.fn().mockResolvedValue(null) })
      });

      await app.register(billingInvoiceExportRoutes);
      
      const response = await app.inject({
        method: 'GET',
        url: '/billing/invoices/export',
        headers: {
          authorization: 'Bearer valid-token'
        }
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('P1-FIX: Org Membership Verification - billingPaddle', () => {
    beforeEach(() => {
      (extractAndVerifyToken as jest.Mock).mockReturnValue({
        valid: true,
        claims: {
          sub: 'user-123',
          orgId: '550e8400-e29b-41d4-a716-446655440000'
        }
      });
    });

    it('should verify membership before paddle checkout', async () => {
      await app.register(billingPaddleRoutes);
      
      const response = await app.inject({
        method: 'POST',
        url: '/billing/paddle/checkout',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json'
        },
        payload: {
          planId: 'plan_123'
        }
      });

      // Should verify membership
      expect(mockMembershipDb).toHaveBeenCalled();
    });

    it('should reject checkout for non-members', async () => {
      mockMembershipDb.mockReturnValue({
        where: jest.fn().mockReturnValue({ first: jest.fn().mockResolvedValue(null) })
      });

      await app.register(billingPaddleRoutes);
      
      const response = await app.inject({
        method: 'POST',
        url: '/billing/paddle/checkout',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json'
        },
        payload: {
          planId: 'plan_123'
        }
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('ORG_MEMBERSHIP_REQUIRED');
    });

    it('should reject when userId is missing', async () => {
      (extractAndVerifyToken as jest.Mock).mockReturnValue({
        valid: true,
        claims: {
          // No sub
          orgId: '550e8400-e29b-41d4-a716-446655440000'
        }
      });

      await app.register(billingPaddleRoutes);
      
      const response = await app.inject({
        method: 'POST',
        url: '/billing/paddle/checkout',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json'
        },
        payload: {
          planId: 'plan_123'
        }
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe('P1-FIX: Org Membership Verification - billingStripe', () => {
    beforeEach(() => {
      (extractAndVerifyToken as jest.Mock).mockReturnValue({
        valid: true,
        claims: {
          sub: 'user-123',
          orgId: '550e8400-e29b-41d4-a716-446655440000'
        }
      });
    });

    it('should verify membership before stripe checkout', async () => {
      await app.register(billingStripeRoutes);
      
      const response = await app.inject({
        method: 'POST',
        url: '/billing/stripe/checkout',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json'
        },
        payload: {
          priceId: 'price_123',
          csrfToken: 'a'.repeat(64)
        }
      });

      // Should verify membership before CSRF/processing
      expect(mockMembershipDb).toHaveBeenCalled();
    });

    it('should reject stripe checkout for non-members', async () => {
      mockMembershipDb.mockReturnValue({
        where: jest.fn().mockReturnValue({ first: jest.fn().mockResolvedValue(null) })
      });

      await app.register(billingStripeRoutes);
      
      const response = await app.inject({
        method: 'POST',
        url: '/billing/stripe/checkout',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json'
        },
        payload: {
          priceId: 'price_123',
          csrfToken: 'a'.repeat(64)
        }
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('ORG_MEMBERSHIP_REQUIRED');
    });

    it('should verify membership before generating CSRF token', async () => {
      await app.register(billingStripeRoutes);
      
      const response = await app.inject({
        method: 'GET',
        url: '/billing/stripe/csrf-token',
        headers: {
          authorization: 'Bearer valid-token'
        }
      });

      // Membership check should run
      expect(mockMembershipDb).toHaveBeenCalled();
    });
  });

  describe('Input Validation Security', () => {
    beforeEach(() => {
      (extractAndVerifyToken as jest.Mock).mockReturnValue({
        valid: true,
        claims: {
          sub: 'user-123',
          orgId: '550e8400-e29b-41d4-a716-446655440000'
        }
      });
    });

    it('should reject invalid planId format (Paddle)', async () => {
      await app.register(billingPaddleRoutes);
      
      const response = await app.inject({
        method: 'POST',
        url: '/billing/paddle/checkout',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json'
        },
        payload: {
          planId: '../../../etc/passwd' // Path traversal attempt
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid priceId format (Stripe)', async () => {
      await app.register(billingStripeRoutes);
      
      const response = await app.inject({
        method: 'POST',
        url: '/billing/stripe/checkout',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json'
        },
        payload: {
          priceId: '<script>alert(1)</script>',
          csrfToken: 'a'.repeat(64)
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid CSRF token format', async () => {
      await app.register(billingStripeRoutes);
      
      const response = await app.inject({
        method: 'POST',
        url: '/billing/stripe/checkout',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json'
        },
        payload: {
          priceId: 'price_123',
          csrfToken: 'short-token' // Too short
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should reject invalid orgId format', async () => {
      (extractAndVerifyToken as jest.Mock).mockReturnValue({
        valid: true,
        claims: {
          sub: 'user-123',
          orgId: 'not-a-uuid'
        }
      });

      await app.register(billingPaddleRoutes);
      
      const response = await app.inject({
        method: 'POST',
        url: '/billing/paddle/checkout',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json'
        },
        payload: {
          planId: 'plan_123'
        }
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe('Mass Assignment Protection', () => {
    beforeEach(() => {
      (extractAndVerifyToken as jest.Mock).mockReturnValue({
        valid: true,
        claims: {
          sub: 'user-123',
          orgId: '550e8400-e29b-41d4-a716-446655440000'
        }
      });
    });

    it('should ignore non-whitelisted fields in paddle checkout', async () => {
      await app.register(billingPaddleRoutes);
      
      const response = await app.inject({
        method: 'POST',
        url: '/billing/paddle/checkout',
        headers: {
          authorization: 'Bearer valid-token',
          'content-type': 'application/json'
        },
        payload: {
          planId: 'plan_123',
          maliciousField: 'should-be-ignored',
          admin: true
        }
      });

      // Should not error due to extra fields (they're filtered)
      expect(response.statusCode).not.toBe(500);
    });
  });
});
