/**
 * P0 TEST: SearchIndexingWorker - Search Indexing Job Processing Tests
 *
 * Tests single job processing, batch processing, transaction management,
 * error handling, and event publishing.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SearchIndexingWorker } from '../SearchIndexingWorker';

// Mock logger
vi.mock('@kernel/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock event bus
vi.mock('@kernel/event-bus', () => ({
  EventBus: vi.fn(),
}));

// Helper to create mock job
function createMockJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'job-1',
    contentId: 'content-1',
    indexId: 'index-1',
    action: 'index',
    status: 'pending',
    isPending: vi.fn().mockReturnValue(true),
    start: vi.fn().mockReturnValue({
      ...this,
      id: 'job-1',
      contentId: 'content-1',
      indexId: 'index-1',
      action: overrides.action || 'index',
      status: 'processing',
      isPending: vi.fn().mockReturnValue(false),
      succeed: vi.fn().mockReturnValue({ status: 'completed' }),
      fail: vi.fn().mockReturnValue({ status: 'failed' }),
    }),
    succeed: vi.fn().mockReturnValue({ status: 'completed' }),
    fail: vi.fn().mockReturnValue({ status: 'failed' }),
    ...overrides,
  };
}

// Helper to create mock pool client
function createMockClient() {
  return {
    query: vi.fn().mockResolvedValue({}),
    release: vi.fn(),
  };
}

describe('SearchIndexingWorker', () => {
  let worker: SearchIndexingWorker;
  let mockJobs: Record<string, ReturnType<typeof vi.fn>>;
  let mockDocs: Record<string, ReturnType<typeof vi.fn>>;
  let mockEventBus: Record<string, ReturnType<typeof vi.fn>>;
  let mockPool: Record<string, ReturnType<typeof vi.fn>>;
  let mockContentRepo: Record<string, ReturnType<typeof vi.fn>>;
  let mockClient: ReturnType<typeof createMockClient>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient = createMockClient();

    mockJobs = {
      getById: vi.fn(),
      save: vi.fn().mockResolvedValue(undefined),
      getByIds: undefined as unknown as ReturnType<typeof vi.fn>,
      saveBatch: undefined as unknown as ReturnType<typeof vi.fn>,
      listPending: vi.fn().mockResolvedValue([]),
    };

    mockDocs = {
      upsert: vi.fn().mockResolvedValue(undefined),
      markDeleted: vi.fn().mockResolvedValue(undefined),
    };

    mockEventBus = {
      publish: vi.fn().mockResolvedValue(undefined),
    };

    mockPool = {
      connect: vi.fn().mockResolvedValue(mockClient),
    };

    mockContentRepo = {
      getById: vi.fn().mockResolvedValue({
        title: 'Test Content',
        body: 'Test body text for indexing',
      }),
    };

    worker = new SearchIndexingWorker(
      mockJobs as any,
      mockDocs as any,
      mockEventBus as any,
      mockPool as any,
      mockContentRepo as any,
    );
  });

  describe('process', () => {
    it('should process a pending index job successfully', async () => {
      const job = createMockJob();
      mockJobs.getById.mockResolvedValue(job);

      const result = await worker.process('job-1');
      expect(result.success).toBe(true);
    });

    it('should reject invalid (empty) job ID', async () => {
      const result = await worker.process('');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid job ID');
    });

    it('should reject non-string job ID', async () => {
      const result = await worker.process(123 as unknown as string);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid job ID');
    });

    it('should reject too-long job ID', async () => {
      const result = await worker.process('a'.repeat(256));
      expect(result.success).toBe(false);
      expect(result.error).toContain('exceeds maximum length');
    });

    it('should return error for non-existent job', async () => {
      mockJobs.getById.mockResolvedValue(null);
      const result = await worker.process('job-missing');
      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should return error for non-pending job', async () => {
      const job = createMockJob({ isPending: vi.fn().mockReturnValue(false), status: 'completed' });
      mockJobs.getById.mockResolvedValue(job);

      const result = await worker.process('job-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid job state');
    });

    it('should handle content not found during indexing', async () => {
      const job = createMockJob();
      mockJobs.getById.mockResolvedValue(job);
      mockContentRepo.getById.mockResolvedValue(null);

      const result = await worker.process('job-1');
      expect(result.success).toBe(false);
      expect(result.error).toContain('Content');
    });

    it('should handle delete action', async () => {
      const deleteJob = createMockJob({ action: 'delete' });
      // Make start() return a job with action 'delete'
      deleteJob.start = vi.fn().mockReturnValue({
        ...deleteJob,
        action: 'delete',
        status: 'processing',
        isPending: vi.fn().mockReturnValue(false),
        succeed: vi.fn().mockReturnValue({ status: 'completed' }),
        fail: vi.fn().mockReturnValue({ status: 'failed' }),
      });
      mockJobs.getById.mockResolvedValue(deleteJob);

      const result = await worker.process('job-1');
      expect(result.success).toBe(true);
      expect(mockDocs.markDeleted).toHaveBeenCalled();
    });

    it('should use provided client for transaction', async () => {
      const job = createMockJob();
      mockJobs.getById.mockResolvedValue(job);
      const externalClient = createMockClient();

      await worker.process('job-1', externalClient as any);
      // Should NOT call pool.connect when external client is provided
      expect(mockPool.connect).not.toHaveBeenCalled();
    });

    it('should rollback on database error', async () => {
      mockJobs.getById.mockRejectedValue(new Error('DB connection lost'));

      const result = await worker.process('job-1');
      expect(result.success).toBe(false);
      expect(mockClient.query).toHaveBeenCalledWith('ROLLBACK');
    });

    it('should publish SearchIndexed event on success', async () => {
      const job = createMockJob();
      mockJobs.getById.mockResolvedValue(job);

      await worker.process('job-1');
      expect(mockEventBus.publish).toHaveBeenCalled();
    });
  });

  describe('processBatch', () => {
    it('should reject non-array input', async () => {
      await expect(worker.processBatch('not-an-array' as any)).rejects.toThrow('must be an array');
    });

    it('should reject batch exceeding max size', async () => {
      const bigBatch = Array.from({ length: 101 }, (_, i) => `job-${i}`);
      await expect(worker.processBatch(bigBatch)).rejects.toThrow('exceeds maximum');
    });

    it('should return results for empty pending jobs', async () => {
      // All jobs not found
      mockJobs.getById.mockResolvedValue(null);
      const results = await worker.processBatch(['job-1']);
      expect(results.get('job-1')?.success).toBe(false);
    });
  });

  describe('processPendingBatch', () => {
    it('should return zero counts when no pending jobs', async () => {
      mockJobs.listPending.mockResolvedValue([]);
      const result = await worker.processPendingBatch();
      expect(result.succeeded).toBe(0);
      expect(result.failed).toBe(0);
    });
  });
});
