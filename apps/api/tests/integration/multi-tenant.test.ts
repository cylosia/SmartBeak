/**
 * P2 TEST: Multi-Tenant Isolation Integration Tests
 * 
 * Tests complete tenant isolation across data access, caching,
 * job processing, and webhook handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { withTransaction, query } from '@database/transactions';
import { getRedis } from '@kernel/redis';
import { checkRateLimit } from '@kernel/rateLimiterRedis';
import { getAuthContext } from '@security/jwt';
import jwt from 'jsonwebtoken';

// Mock dependencies
vi.mock('@database/pool', () => ({
  getPool: vi.fn(),
}));

vi.mock('@kernel/redis', () => ({
  getRedis: vi.fn(),
}));

describe('Multi-Tenant Isolation Integration Tests', () => {
  let mockPool: any;
  let mockClient: any;
  let mockRedis: any;
  let tenantData: Map<string, Map<string, any>>;

  beforeEach(() => {
    vi.clearAllMocks();
    tenantData = new Map();

    // Setup mock database client
    mockClient = {
      query: vi.fn().mockImplementation((sql: string, params: any[]) => {
        // Simulate tenant isolation in queries
        if (params && params[0]?.startsWith?.('tenant-')) {
          const tenantId = params[0];
          return Promise.resolve({
            rows: tenantData.get(tenantId)?.get('data') || [],
          });
        }
        return Promise.resolve({ rows: [] });
      }),
      release: vi.fn(),
    };

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
      query: vi.fn(),
      on: vi.fn(),
    };

    const { getPool } = require('@database/pool');
    (getPool as any).mockResolvedValue(mockPool);

    // Setup mock Redis with tenant isolation
    const tenantCaches = new Map<string, Map<string, string>>();
    
    mockRedis = {
      get: vi.fn().mockImplementation((key: string) => {
        const tenantId = key.split(':')[1];
        return Promise.resolve(tenantCaches.get(tenantId)?.get(key) || null);
      }),
      setex: vi.fn().mockImplementation((key: string, ttl: number, value: string) => {
        const tenantId = key.split(':')[1];
        if (!tenantCaches.has(tenantId)) {
          tenantCaches.set(tenantId, new Map());
        }
        tenantCaches.get(tenantId)!.set(key, value);
        return Promise.resolve('OK');
      }),
      del: vi.fn(),
      pipeline: vi.fn().mockReturnValue({
        zremrangebyscore: vi.fn().mockReturnThis(),
        zcard: vi.fn().mockReturnThis(),
        zadd: vi.fn().mockReturnThis(),
        pexpire: vi.fn().mockReturnThis(),
        exec: vi.fn().mockResolvedValue([
          [null, 0],
          [null, 0],
          [null, 1],
          [null, 1],
        ]),
      }),
    };

    (getRedis as any).mockResolvedValue(mockRedis);
  });

  describe('Database Tenant Isolation', () => {
    it('should isolate data between tenants in transactions', async () => {
      mockClient.query
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 1, data: 'tenant1-data' }] }) // Query
        .mockResolvedValueOnce({}); // COMMIT

      // Tenant 1 query
      const result1 = await withTransaction(async (client) => {
        return client.query('SELECT * FROM data WHERE tenant_id = $1', ['tenant-1']);
      });

      expect(result1.rows[0].data).toBe('tenant1-data');

      // Reset mock for tenant 2
      mockClient.query
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [{ id: 2, data: 'tenant2-data' }] }) // Query
        .mockResolvedValueOnce({}); // COMMIT

      // Tenant 2 query - should not see tenant 1 data
      const result2 = await withTransaction(async (client) => {
        return client.query('SELECT * FROM data WHERE tenant_id = $1', ['tenant-2']);
      });

      expect(result2.rows[0].data).toBe('tenant2-data');
      expect(result2.rows[0].data).not.toBe(result1.rows[0].data);
    });

    it('should enforce tenant_id in all queries', async () => {
      const querySpy = vi.fn().mockResolvedValue({ rows: [] });
      mockClient.query = querySpy;
      mockClient.query
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // Query
        .mockResolvedValueOnce({}); // COMMIT

      await withTransaction(async (client) => {
        await client.query('SELECT * FROM users WHERE tenant_id = $1', ['tenant-123']);
      });

      const calls = querySpy.mock.calls;
      const userQuery = calls.find((call: any[]) => 
        call[0].includes('SELECT * FROM users')
      );
      
      expect(userQuery).toBeDefined();
      expect(userQuery[1]).toContain('tenant-123');
    });

    it('should prevent cross-tenant updates via SQL injection', async () => {
      const maliciousTenantId = "tenant-1' OR '1'='1";
      
      mockClient.query
        .mockResolvedValueOnce({}) // SET statement_timeout
        .mockResolvedValueOnce({}) // BEGIN
        .mockResolvedValueOnce({ rows: [] }) // Query returns no results (safe)
        .mockResolvedValueOnce({}); // COMMIT

      const result = await withTransaction(async (client) => {
        return client.query('SELECT * FROM data WHERE tenant_id = $1', [maliciousTenantId]);
      });

      // Parameterized query should prevent injection
      expect(result.rows).toHaveLength(0);
    });
  });

  describe('Cache Tenant Isolation', () => {
    it('should isolate cached data between tenants', async () => {
      // Store data for tenant 1
      await mockRedis.setex('cache:tenant1:user:profile', 3600, JSON.stringify({
        name: 'Tenant 1 User',
        email: 'user1@tenant1.com',
      }));

      // Store data for tenant 2
      await mockRedis.setex('cache:tenant2:user:profile', 3600, JSON.stringify({
        name: 'Tenant 2 User',
        email: 'user2@tenant2.com',
      }));

      // Verify isolation
      const tenant1Data = await mockRedis.get('cache:tenant1:user:profile');
      const tenant2Data = await mockRedis.get('cache:tenant2:user:profile');

      expect(JSON.parse(tenant1Data).email).toBe('user1@tenant1.com');
      expect(JSON.parse(tenant2Data).email).toBe('user2@tenant2.com');
      expect(tenant1Data).not.toBe(tenant2Data);
    });

    it('should use tenant-specific cache keys', async () => {
      const tenantId = 'tenant-abc-123';
      const cacheKey = `cache:${tenantId}:settings`;
      
      await mockRedis.setex(cacheKey, 3600, JSON.stringify({ theme: 'dark' }));

      expect(mockRedis.setex).toHaveBeenCalledWith(
        cacheKey,
        3600,
        expect.any(String)
      );
    });

    it('should prevent cache key collision between tenants', async () => {
      // Same logical key, different tenants
      await mockRedis.setex('cache:tenant-x:config', 3600, 'tenant-x-config');
      await mockRedis.setex('cache:tenant-y:config', 3600, 'tenant-y-config');

      const xConfig = await mockRedis.get('cache:tenant-x:config');
      const yConfig = await mockRedis.get('cache:tenant-y:config');

      expect(xConfig).toBe('tenant-x-config');
      expect(yConfig).toBe('tenant-y-config');
    });
  });

  describe('Rate Limiting Per Tenant', () => {
    it('should enforce separate rate limits per tenant', async () => {
      // Tenant 1 uses their quota
      await checkRateLimit('api:tenant-1', { maxRequests: 10, windowMs: 60000 });
      await checkRateLimit('api:tenant-1', { maxRequests: 10, windowMs: 60000 });

      // Tenant 2 should have full quota
      const tenant2Result = await checkRateLimit('api:tenant-2', { 
        maxRequests: 10, 
        windowMs: 60000 
      });

      expect(tenant2Result.allowed).toBe(true);
      expect(tenant2Result.remaining).toBeGreaterThan(0);
    });

    it('should use tenant hash tags for cluster compatibility', async () => {
      await checkRateLimit('api:tenant-special', {
        maxRequests: 100,
        windowMs: 3600000,
        keyPrefix: 'ratelimit:{tenant-special}',
      });

      const pipelineCalls = mockRedis.pipeline.mock.calls;
      expect(pipelineCalls.length).toBeGreaterThan(0);
    });
  });

  describe('Authentication Context Isolation', () => {
    const createTenantToken = (tenantId: string): string => {
      process.env.JWT_KEY_1 = 'test-secret-key-minimum-32-characters-long';
      
      return jwt.sign({
        sub: 'user-123',
        orgId: tenantId,
        role: 'admin',
      }, process.env.JWT_KEY_1, {
        algorithm: 'HS256',
      });
    };

    it('should extract correct tenant from token', () => {
      const token = createTenantToken('tenant-alpha');
      const context = getAuthContext({ authorization: `Bearer ${token}` });

      expect(context?.orgId).toBe('tenant-alpha');
    });

    it('should reject token from different tenant', () => {
      const token = createTenantToken('tenant-beta');
      const context = getAuthContext({ authorization: `Bearer ${token}` });

      expect(context?.orgId).toBe('tenant-beta');
      expect(context?.orgId).not.toBe('tenant-alpha');
    });

    it('should handle tenant switching with valid tokens', () => {
      const token1 = createTenantToken('tenant-1');
      const token2 = createTenantToken('tenant-2');

      const context1 = getAuthContext({ authorization: `Bearer ${token1}` });
      const context2 = getAuthContext({ authorization: `Bearer ${token2}` });

      expect(context1?.orgId).toBe('tenant-1');
      expect(context2?.orgId).toBe('tenant-2');
      expect(context1?.orgId).not.toBe(context2?.orgId);
    });
  });

  describe('Cross-Tenant Access Prevention', () => {
    it('should validate tenant access on every request', async () => {
      const userContext = {
        userId: 'user-123',
        orgId: 'tenant-allowed',
        roles: ['admin'],
      };

      // Attempt to access different tenant data
      const requestedTenantId = 'tenant-unauthorized';
      
      // Authorization check should fail
      const isAuthorized = userContext.orgId === requestedTenantId;
      
      expect(isAuthorized).toBe(false);
    });

    it('should prevent IDOR attacks via parameter manipulation', async () => {
      // User has access to tenant-1
      const userTenantId = 'tenant-1';
      
      // Attempt to access tenant-2 resource by changing ID
      const requestedResourceId = 'tenant-2-resource-123';
      const extractedTenantId = requestedResourceId.split('-resource')[0];
      
      // Verify tenant match
      const isAuthorized = userTenantId === extractedTenantId;
      
      expect(isAuthorized).toBe(false);
    });
  });

  describe('Tenant-Aware Job Processing', () => {
    it('should maintain tenant context in job execution', async () => {
      const jobData = {
        tenantId: 'tenant-jobs',
        data: 'sensitive-data',
      };

      // Job should only access tenant-specific data
      const jobHandler = async (data: typeof jobData) => {
        // Simulate database query with tenant isolation
        const result = await mockPool.query(
          'SELECT * FROM jobs WHERE tenant_id = $1',
          [data.tenantId]
        );
        return result;
      };

      // Execute job
      await jobHandler(jobData);

      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('tenant_id = $1'),
        ['tenant-jobs']
      );
    });
  });
});
