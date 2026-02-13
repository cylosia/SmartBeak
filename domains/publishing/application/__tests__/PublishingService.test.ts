/**
 * P2 TEST: PublishingService - Job Creation, Retry, Cancel Tests
 *
 * Tests publish flow, input validation, target verification,
 * retry logic, cancellation, and transaction handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PublishingService } from '../PublishingService';

// Mock logger
vi.mock('@kernel/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock PublishingJob entity
vi.mock('../../domain/entities/PublishingJob', () => ({
  PublishingJob: {
    create: vi.fn((id: string, domainId: string, contentId: string, targetId: string) => ({
      id,
      domainId,
      contentId,
      targetId,
      status: 'pending',
      canRetry: vi.fn().mockReturnValue(false),
      retry: vi.fn().mockReturnValue({ id, status: 'pending', retryCount: 1 }),
    })),
  },
}));

function createMockClient(targetRows: Record<string, unknown>[] = []) {
  return {
    query: vi.fn().mockImplementation((sql: string, _params?: unknown[]) => {
      if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
        return {};
      }
      if (sql.includes('SELECT * FROM publish_targets')) {
        return { rows: targetRows };
      }
      return { rows: [] };
    }),
    release: vi.fn(),
  };
}

describe('PublishingService', () => {
  let service: PublishingService;
  let mockJobs: Record<string, ReturnType<typeof vi.fn>>;
  let mockTargets: Record<string, ReturnType<typeof vi.fn>>;
  let mockPool: Record<string, ReturnType<typeof vi.fn>>;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockClient = createMockClient([
      { id: 'target-1', domain_id: 'domain-1', type: 'webhook' },
    ]);

    mockJobs = {
      getById: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      delete: vi.fn().mockResolvedValue(undefined),
    };

    mockTargets = {
      getById: vi.fn(),
    };

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    service = new PublishingService(
      mockJobs as any,
      mockTargets as any,
      mockPool as any,
    );
  });

  // ============================================================================
  // publish
  // ============================================================================

  describe('publish', () => {
    it('should create a publishing job successfully', async () => {
      const result = await service.publish('domain-1', 'content-1', 'target-1');
      expect(result.success).toBe(true);
      expect(result.job).toBeDefined();
      expect(mockClient.query).toHaveBeenCalledWith('BEGIN');
      expect(mockClient.query).toHaveBeenCalledWith('COMMIT');
    });

    it('should reject empty domainId', async () => {
      const result = await service.publish('', 'content-1', 'target-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Domain ID is required');
    });

    it('should reject empty contentId', async () => {
      const result = await service.publish('domain-1', '', 'target-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Content ID is required');
    });

    it('should reject empty targetId', async () => {
      const result = await service.publish('domain-1', 'content-1', '');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Target ID is required');
    });

    it('should reject domainId exceeding max length', async () => {
      const result = await service.publish('a'.repeat(256), 'content-1', 'target-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('255 characters');
    });

    it('should return error when target not found', async () => {
      mockClient = createMockClient([]); // No target rows
      mockPool.connect.mockResolvedValue(mockClient);
      service = new PublishingService(mockJobs as any, mockTargets as any, mockPool as any);

      const result = await service.publish('domain-1', 'content-1', 'target-missing');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when target belongs to different domain', async () => {
      mockClient = createMockClient([
        { id: 'target-1', domain_id: 'other-domain', type: 'webhook' },
      ]);
      mockPool.connect.mockResolvedValue(mockClient);
      service = new PublishingService(mockJobs as any, mockTargets as any, mockPool as any);

      const result = await service.publish('domain-1', 'content-1', 'target-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not belong');
    });

    it('should rollback on error and release client', async () => {
      mockClient.query.mockRejectedValueOnce(new Error('DB error'));
      const freshClient = createMockClient();
      freshClient.query.mockImplementation((sql: string) => {
        if (sql === 'BEGIN') throw new Error('DB error');
        return { rows: [] };
      });
      mockPool.connect.mockResolvedValue(freshClient);
      service = new PublishingService(mockJobs as any, mockTargets as any, mockPool as any);

      const result = await service.publish('domain-1', 'content-1', 'target-1');
      expect(result.success).toBe(false);
      expect(freshClient.release).toHaveBeenCalled();
    });
  });

  // ============================================================================
  // retry
  // ============================================================================

  describe('retry', () => {
    it('should reject empty jobId', async () => {
      const result = await service.retry('');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Job ID is required');
    });

    it('should return error for non-existent job', async () => {
      mockJobs.getById.mockResolvedValue(null);
      const result = await service.retry('job-missing');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error when job cannot be retried', async () => {
      mockJobs.getById.mockResolvedValue({
        id: 'job-1',
        status: 'completed',
        canRetry: vi.fn().mockReturnValue(false),
      });
      const result = await service.retry('job-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('cannot be retried');
    });

    it('should retry a failed job successfully', async () => {
      const retriedJob = { id: 'job-1', status: 'pending', retryCount: 1 };
      mockJobs.getById.mockResolvedValue({
        id: 'job-1',
        status: 'failed',
        canRetry: vi.fn().mockReturnValue(true),
        retry: vi.fn().mockReturnValue(retriedJob),
      });
      const result = await service.retry('job-1');
      expect(result.success).toBe(true);
      expect(mockJobs.save).toHaveBeenCalledWith(retriedJob);
    });
  });

  // ============================================================================
  // cancel
  // ============================================================================

  describe('cancel', () => {
    it('should reject empty jobId', async () => {
      const result = await service.cancel('');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Job ID is required');
    });

    it('should return error for non-existent job', async () => {
      mockJobs.getById.mockResolvedValue(null);
      const result = await service.cancel('job-missing');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error for non-pending job', async () => {
      mockJobs.getById.mockResolvedValue({ id: 'job-1', status: 'processing' });
      const result = await service.cancel('job-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot cancel');
    });

    it('should cancel a pending job successfully', async () => {
      mockJobs.getById.mockResolvedValue({ id: 'job-1', status: 'pending' });
      const result = await service.cancel('job-1');
      expect(result.success).toBe(true);
      expect(mockJobs.delete).toHaveBeenCalledWith('job-1');
    });
  });
});
