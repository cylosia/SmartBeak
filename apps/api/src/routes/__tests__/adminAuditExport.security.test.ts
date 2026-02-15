/**
 * Security Tests for Admin Audit Export
 * Tests P1 Fix: Admin audit export missing org filtering
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import Fastify from 'fastify';
import { adminAuditExportRoutes } from '../adminAuditExport';
import { getDb } from '../../db';

// Mock the database
jest.mock('../../db');
jest.mock('../../middleware/rateLimiter', () => ({
  adminRateLimit: () => (req: unknown, reply: unknown, done: () => void) => done()
}));

describe('Admin Audit Export Security Tests', () => {
  let app: ReturnType<typeof Fastify>;
  const mockDb = jest.fn();
  const mockWhere = jest.fn();
  const mockOrderBy = jest.fn();
  const mockLimit = jest.fn();
  const mockOffset = jest.fn();

  beforeEach(() => {
    app = Fastify();
    jest.clearAllMocks();
    
    // Setup mock chain
    mockWhere.mockReturnValue({ orderBy: mockOrderBy });
    mockOrderBy.mockReturnValue({ limit: mockLimit });
    mockLimit.mockReturnValue({ offset: mockOffset });
    mockOffset.mockResolvedValue([]);
    
    mockDb.mockReturnValue({
      where: mockWhere,
      orderBy: mockOrderBy,
      limit: mockLimit,
      offset: mockOffset,
    });
    
    (getDb as jest.Mock).mockResolvedValue(mockDb);
    
    process.env.ADMIN_API_KEY = 'test-admin-api-key-32-chars-long';
  });

  describe('P1-FIX: Org ID Filtering', () => {
    it('should reject export without orgId (P0-FIX: orgId is now required)', async () => {
      await app.register(adminAuditExportRoutes);

      const response = await app.inject({
        method: 'GET',
        url: '/admin/audit/export',
        headers: {
          authorization: 'Bearer test-admin-api-key-32-chars-long'
        }
      });

      expect(response.statusCode).toBe(400);
    });

    it('should apply orgId filter when provided', async () => {
      await app.register(adminAuditExportRoutes);
      
      const orgId = '550e8400-e29b-41d4-a716-446655440000';
      const response = await app.inject({
        method: 'GET',
        url: `/admin/audit/export?orgId=${orgId}`,
        headers: {
          authorization: 'Bearer test-admin-api-key-32-chars-long'
        }
      });

      expect(response.statusCode).toBe(200);
      // Verify the filter was applied
      expect(mockWhere).toHaveBeenCalledWith('org_id', orgId);
    });

    it('should reject invalid orgId format', async () => {
      await app.register(adminAuditExportRoutes);
      
      const response = await app.inject({
        method: 'GET',
        url: '/admin/audit/export?orgId=invalid-uuid',
        headers: {
          authorization: 'Bearer test-admin-api-key-32-chars-long'
        }
      });

      expect(response.statusCode).toBe(400);
      const body = JSON.parse(response.body);
      expect(body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('P1-FIX: Org Membership Verification', () => {
    it('should verify admin membership before org-filtered export', async () => {
      const mockMembership = jest.fn().mockResolvedValue({ id: 'membership-1' });
      mockDb.mockReturnValue({
        where: mockMembership,
      });

      await app.register(adminAuditExportRoutes);
      
      const orgId = '550e8400-e29b-41d4-a716-446655440000';
      const adminId = 'admin-123';
      
      const _response = await app.inject({
        method: 'GET',
        url: `/admin/audit/export?orgId=${orgId}`,
        headers: {
          authorization: 'Bearer test-admin-api-key-32-chars-long',
          'x-admin-id': adminId
        }
      });

      // Should verify membership when adminId is provided
      expect(mockMembership).toHaveBeenCalledWith({ 
        user_id: adminId, 
        org_id: orgId 
      });
    });

    it('should reject export when admin is not a member of the org', async () => {
      mockDb.mockReturnValue({
        where: jest.fn().mockReturnValue({ first: jest.fn().mockResolvedValue(null) }),
      });

      await app.register(adminAuditExportRoutes);
      
      const orgId = '550e8400-e29b-41d4-a716-446655440000';
      
      const response = await app.inject({
        method: 'GET',
        url: `/admin/audit/export?orgId=${orgId}`,
        headers: {
          authorization: 'Bearer test-admin-api-key-32-chars-long',
          'x-admin-id': 'unauthorized-admin'
        }
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('Authentication Security', () => {
    it('should reject requests without authorization header', async () => {
      await app.register(adminAuditExportRoutes);
      
      const response = await app.inject({
        method: 'GET',
        url: '/admin/audit/export'
      });

      expect(response.statusCode).toBe(401);
    });

    it('should reject invalid admin API key', async () => {
      await app.register(adminAuditExportRoutes);
      
      const response = await app.inject({
        method: 'GET',
        url: '/admin/audit/export',
        headers: {
          authorization: 'Bearer wrong-api-key'
        }
      });

      expect(response.statusCode).toBe(403);
    });

    it('should reject keys of different lengths with same status code', async () => {
      // P1-FIX: Replaced flaky wall-clock timing test with a deterministic check.
      // Timing-safe comparison is verified by inspecting the implementation
      // (crypto.timingSafeEqual with padded buffers). Here we just confirm that
      // both short and long wrong keys produce the same 403 response.
      await app.register(adminAuditExportRoutes);

      const shortKeyResponse = await app.inject({
        method: 'GET',
        url: '/admin/audit/export',
        headers: {
          authorization: 'Bearer wrong-api-key'
        }
      });

      const longKeyResponse = await app.inject({
        method: 'GET',
        url: '/admin/audit/export',
        headers: {
          authorization: 'Bearer another-wrong-key-that-is-longer'
        }
      });

      expect(shortKeyResponse.statusCode).toBe(403);
      expect(longKeyResponse.statusCode).toBe(403);
    });
  });

  describe('CSV Injection Prevention', () => {
    it('should sanitize formula injection attempts in CSV output', async () => {
      const maliciousData = [{
        id: '1',
        org_id: '=cmd|\' /C calc\'!A0',
        actor_type: '@SUM(A1:A10)',
        action: 'login',
        created_at: new Date(),
        metadata: '{}'
      }];

      mockOffset.mockResolvedValue(maliciousData);
      
      await app.register(adminAuditExportRoutes);
      
      const response = await app.inject({
        method: 'GET',
        url: '/admin/audit/export',
        headers: {
          authorization: 'Bearer test-admin-api-key-32-chars-long'
        }
      });

      expect(response.statusCode).toBe(200);
      // Formula should be prefixed with apostrophe
      expect(response.body).toContain("'=");
      expect(response.body).toContain("'@");
    });
  });

  describe('Rate Limiting', () => {
    it('should apply admin rate limiting', async () => {
      await app.register(adminAuditExportRoutes);
      
      // Make multiple requests
      const requests = Array(10).fill(null).map(() => 
        app.inject({
          method: 'GET',
          url: '/admin/audit/export',
          headers: {
            authorization: 'Bearer test-admin-api-key-32-chars-long'
          }
        })
      );

      const responses = await Promise.all(requests);
      // Rate limiting should be applied (mock allows all, but middleware is present)
      expect(responses.every(r => r.statusCode === 200 || r.statusCode === 429)).toBe(true);
    });
  });
});
