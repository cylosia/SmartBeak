/**
 * P2 TEST: CustomersService - CRUD Operations Tests
 *
 * Tests getById, listByOrg, create, updateStatus, delete,
 * input validation, pagination, and error handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CustomersService } from '../CustomersService';

const now = new Date();
const sampleRow = {
  id: 'cust-1',
  orgId: 'org-1',
  name: 'Alice',
  email: 'alice@example.com',
  status: 'active',
  createdAt: now,
  updatedAt: now,
};

function createMockPool(overrides: Record<string, unknown> = {}) {
  return {
    query: vi.fn().mockResolvedValue({ rows: [sampleRow], rowCount: 1 }),
    ...overrides,
  };
}

describe('CustomersService', () => {
  let service: CustomersService;
  let mockPool: ReturnType<typeof createMockPool>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPool = createMockPool();
    service = new CustomersService(mockPool as any);
  });

  // ============================================================================
  // getById
  // ============================================================================

  describe('getById', () => {
    it('should return customer for valid ID', async () => {
      const result = await service.getById('cust-1');
      expect(result.success).toBe(true);
      expect(result.customer).toBeDefined();
      expect(result.customer!.id).toBe('cust-1');
      expect(result.customer!.name).toBe('Alice');
    });

    it('should return error for empty ID', async () => {
      const result = await service.getById('');
      expect(result.success).toBe(false);
      expect(result.error).toContain('ID is required');
    });

    it('should return error for non-string ID', async () => {
      const result = await service.getById(123 as unknown as string);
      expect(result.success).toBe(false);
      expect(result.error).toContain('ID is required');
    });

    it('should return error when customer not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const result = await service.getById('cust-missing');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle database errors', async () => {
      mockPool.query.mockRejectedValueOnce(new Error('Connection lost'));
      const result = await service.getById('cust-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection lost');
    });
  });

  // ============================================================================
  // listByOrg
  // ============================================================================

  describe('listByOrg', () => {
    it('should list customers with default pagination', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [sampleRow] })  // SELECT
        .mockResolvedValueOnce({ rows: [{ count: '1' }] });  // COUNT
      const result = await service.listByOrg('org-1');
      expect(result.success).toBe(true);
      expect(result.customers).toHaveLength(1);
    });

    it('should reject empty orgId', async () => {
      const result = await service.listByOrg('');
      expect(result.success).toBe(false);
      expect(result.error).toContain('ID is required');
    });

    it('should clamp page to minimum 1', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] });
      await service.listByOrg('org-1', -5);
      // Should use offset 0 (page 1), not negative
      const call = mockPool.query.mock.calls[0];
      expect(call[1][2]).toBe(0); // offset = 0
    });

    it('should clamp pageSize to MAX_PAGE_SIZE', async () => {
      mockPool.query
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ count: '0' }] });
      await service.listByOrg('org-1', 1, 500);
      const call = mockPool.query.mock.calls[0];
      expect(call[1][1]).toBeLessThanOrEqual(100); // limit capped at 100
    });
  });

  // ============================================================================
  // create
  // ============================================================================

  describe('create', () => {
    it('should create a customer successfully', async () => {
      const result = await service.create('org-1', 'Bob', 'bob@example.com');
      expect(result.success).toBe(true);
      expect(mockPool.query).toHaveBeenCalledWith(
        expect.stringContaining('INSERT INTO customers'),
        expect.any(Array),
      );
    });

    it('should reject empty name', async () => {
      const result = await service.create('org-1', '', 'bob@example.com');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Name is required');
    });

    it('should reject name exceeding max length', async () => {
      const result = await service.create('org-1', 'a'.repeat(256), 'bob@example.com');
      expect(result.success).toBe(false);
      expect(result.error).toContain('255 characters');
    });

    it('should reject invalid email', async () => {
      const result = await service.create('org-1', 'Bob', 'not-an-email');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid email');
    });

    it('should reject empty orgId', async () => {
      const result = await service.create('', 'Bob', 'bob@example.com');
      expect(result.success).toBe(false);
    });

    it('should handle duplicate email (unique constraint violation)', async () => {
      const pgError = Object.assign(new Error('unique_violation'), { code: '23505' });
      mockPool.query.mockRejectedValueOnce(pgError);
      const result = await service.create('org-1', 'Bob', 'existing@example.com');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Email already exists');
    });
  });

  // ============================================================================
  // updateStatus
  // ============================================================================

  describe('updateStatus', () => {
    it('should update status successfully', async () => {
      const result = await service.updateStatus('cust-1', 'inactive');
      expect(result.success).toBe(true);
    });

    it('should reject invalid status', async () => {
      const result = await service.updateStatus('cust-1', 'banned' as any);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid status');
    });

    it('should reject empty ID', async () => {
      const result = await service.updateStatus('', 'active');
      expect(result.success).toBe(false);
    });

    it('should return error when customer not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [] });
      const result = await service.updateStatus('cust-missing', 'inactive');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });

  // ============================================================================
  // delete
  // ============================================================================

  describe('delete', () => {
    it('should delete customer successfully', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [{ id: 'cust-1' }], rowCount: 1 });
      const result = await service.delete('cust-1');
      expect(result.success).toBe(true);
    });

    it('should reject empty ID', async () => {
      const result = await service.delete('');
      expect(result.success).toBe(false);
    });

    it('should return error when customer not found', async () => {
      mockPool.query.mockResolvedValueOnce({ rows: [], rowCount: 0 });
      const result = await service.delete('cust-missing');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });
  });
});
