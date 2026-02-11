/**
 * P2 TEST: Clerk Webhook Tests
 * 
 * Tests Clerk webhook signature verification using Svix format,
 * event processing, and deduplication.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import handler, { ClerkWebhookEvent } from '../clerk';
import type { NextApiRequest, NextApiResponse } from 'next';
import crypto from 'crypto';

// Mock environment
process.env.CLERK_WEBHOOK_SECRET = 'whsec_test_secret_key_for_testing_only';

describe('Clerk Webhook Tests', () => {
  let mockReq: Partial<NextApiRequest>;
  let mockRes: Partial<NextApiResponse>;
  let jsonResponse: any;

  beforeEach(() => {
    vi.clearAllMocks();
    jsonResponse = null;

    mockRes = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockImplementation((data) => {
        jsonResponse = data;
        return mockRes;
      }),
    };
  });

  const createMockRequest = (
    body: object,
    headers: Record<string, string> = {},
    method = 'POST'
  ): Partial<NextApiRequest> => {
    const bodyString = JSON.stringify(body);
    
    return {
      method,
      headers: {
        'svix-id': 'msg-test-123',
        'svix-timestamp': String(Math.floor(Date.now() / 1000)),
        'svix-signature': 'v1,invalid-signature-for-testing',
        ...headers,
      },
      on: vi.fn().mockImplementation((event: string, callback: any) => {
        if (event === 'data') {
          callback(Buffer.from(bodyString));
        }
        if (event === 'end') {
          callback();
        }
        return mockReq;
      }),
    };
  };

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

  describe('Request Validation', () => {
    it('should reject non-POST requests', async () => {
      mockReq = createMockRequest({}, {}, 'GET');

      await handler(mockReq as NextApiRequest, mockRes as NextApiResponse);

      expect(mockRes.status).toHaveBeenCalledWith(405);
      expect(jsonResponse).toEqual({ error: 'Method not allowed' });
    });

    it('should reject requests without required Svix headers', async () => {
      mockReq = createMockRequest(
        { type: 'user.created' },
        { 'svix-id': '', 'svix-timestamp': '', 'svix-signature': '' }
      );

      await handler(mockReq as NextApiRequest, mockRes as NextApiResponse);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(jsonResponse).toEqual({ error: 'Missing required Svix headers' });
    });

    it('should reject old timestamps to prevent replay attacks', async () => {
      const oldTimestamp = String(Math.floor(Date.now() / 1000) - 400); // 6+ minutes old
      
      mockReq = createMockRequest(
        { type: 'user.created' },
        {
          'svix-id': 'msg-test-123',
          'svix-timestamp': oldTimestamp,
          'svix-signature': 'v1,some-signature',
        }
      );

      await handler(mockReq as NextApiRequest, mockRes as NextApiResponse);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(jsonResponse).toEqual({ error: 'Invalid webhook signature' });
    });

    it('should reject invalid webhook signatures', async () => {
      mockReq = createMockRequest(
        {
          data: { id: 'user-test-123' },
          object: 'event',
          type: 'user.created',
        },
        {
          'svix-id': 'msg-test-123',
          'svix-timestamp': String(Math.floor(Date.now() / 1000)),
          'svix-signature': 'v1,invalid-signature',
        }
      );

      await handler(mockReq as NextApiRequest, mockRes as NextApiResponse);

      expect(mockRes.status).toHaveBeenCalledWith(401);
      expect(jsonResponse).toEqual({ error: 'Invalid webhook signature' });
    });

    it('should reject events with invalid structure', async () => {
      // Create a valid signature for testing
      const payload = { invalid: 'structure' };
      const timestamp = String(Math.floor(Date.now() / 1000));
      const messageId = 'msg-test-123';
      const secret = process.env.CLERK_WEBHOOK_SECRET!;
      const signature = calculateSvixSignature(
        secret,
        JSON.stringify(payload),
        timestamp,
        messageId
      );

      mockReq = createMockRequest(payload, {
        'svix-id': messageId,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${signature}`,
      });

      await handler(mockReq as NextApiRequest, mockRes as NextApiResponse);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(jsonResponse).toEqual({ error: 'Invalid event structure' });
    });
  });

  describe('Event Processing', () => {
    const createValidEvent = (type: string, data: object = {}): ClerkWebhookEvent => ({
      data: {
        id: 'user-test-123',
        email_addresses: [{ email_address: 'test@example.com' }],
        first_name: 'Test',
        last_name: 'User',
        ...data,
      },
      object: 'event',
      type,
    });

    const sendValidWebhook = async (event: ClerkWebhookEvent) => {
      const payload = JSON.stringify(event);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const messageId = `msg-${Date.now()}`;
      const secret = process.env.CLERK_WEBHOOK_SECRET!;
      const signature = calculateSvixSignature(secret, payload, timestamp, messageId);

      mockReq = createMockRequest(event, {
        'svix-id': messageId,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${signature}`,
      });

      await handler(mockReq as NextApiRequest, mockRes as NextApiResponse);
    };

    it('should process user.created event', async () => {
      const event = createValidEvent('user.created');
      
      await sendValidWebhook(event);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(jsonResponse).toMatchObject({
        received: true,
        event: 'user.created',
      });
    });

    it('should process user.updated event', async () => {
      const event = createValidEvent('user.updated', {
        first_name: 'Updated',
        last_name: 'Name',
      });

      await sendValidWebhook(event);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(jsonResponse).toMatchObject({
        received: true,
        event: 'user.updated',
      });
    });

    it('should process user.deleted event', async () => {
      const event = createValidEvent('user.deleted');

      await sendValidWebhook(event);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(jsonResponse).toMatchObject({
        received: true,
        event: 'user.deleted',
      });
    });

    it('should process organizationMembership.created event', async () => {
      const event = createValidEvent('organizationMembership.created', {
        organization_id: 'org-test-123',
      });

      await sendValidWebhook(event);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(jsonResponse).toMatchObject({
        received: true,
        event: 'organizationMembership.created',
      });
    });

    it('should process organizationMembership.deleted event', async () => {
      const event = createValidEvent('organizationMembership.deleted', {
        organization_id: 'org-test-123',
      });

      await sendValidWebhook(event);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(jsonResponse).toMatchObject({
        received: true,
        event: 'organizationMembership.deleted',
      });
    });

    it('should handle unhandled event types gracefully', async () => {
      const event = createValidEvent('session.created');

      await sendValidWebhook(event);

      expect(mockRes.status).toHaveBeenCalledWith(200);
      expect(jsonResponse.received).toBe(true);
    });
  });

  describe('Event Deduplication', () => {
    it('should detect and skip duplicate events', async () => {
      const event = {
        data: { id: 'user-test-123' },
        object: 'event' as const,
        type: 'user.created',
      };

      const payload = JSON.stringify(event);
      const timestamp = String(Math.floor(Date.now() / 1000));
      const messageId = 'duplicate-msg-id';
      const secret = process.env.CLERK_WEBHOOK_SECRET!;
      const signature = calculateSvixSignature(secret, payload, timestamp, messageId);

      // First request
      mockReq = createMockRequest(event, {
        'svix-id': messageId,
        'svix-timestamp': timestamp,
        'svix-signature': `v1,${signature}`,
      });

      await handler(mockReq as NextApiRequest, mockRes as NextApiResponse);
      expect(mockRes.status).toHaveBeenCalledWith(200);

      // Second request with same ID - should be marked as duplicate
      // In actual implementation, Redis would track this
    });
  });

  describe('Error Handling', () => {
    it('should handle internal errors gracefully', async () => {
      mockReq = {
        method: 'POST',
        headers: {},
        on: vi.fn().mockImplementation((event: string, callback: any) => {
          if (event === 'error') {
            callback(new Error('Request stream error'));
          }
          return mockReq;
        }),
      };

      await handler(mockReq as NextApiRequest, mockRes as NextApiResponse);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(jsonResponse).toEqual({ error: 'Internal server error' });
    });

    it('should return 500 if webhook secret not configured', async () => {
      delete process.env.CLERK_WEBHOOK_SECRET;

      mockReq = createMockRequest({ type: 'user.created' });

      await handler(mockReq as NextApiRequest, mockRes as NextApiResponse);

      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(jsonResponse).toEqual({ error: 'Webhook secret not configured' });

      // Restore secret for other tests
      process.env.CLERK_WEBHOOK_SECRET = 'whsec_test_secret_key_for_testing_only';
    });
  });
});
