
import { LRUCache } from 'lru-cache';
import { Pool } from 'pg';

export interface JobCacheEntry {
  id: string;
  status: string;
  created_at: Date;
}

// P1-FIX: Added max size limits and proper cleanup for large array values
const MAX_JOBS_PER_DOMAIN = 1000;

function calculateEntrySize(jobs: JobCacheEntry[]): number {
  // Rough estimate: each job entry is approximately 200 bytes
  return jobs.length * 200;
}

const cache = new LRUCache<string, JobCacheEntry[]>({
  max: 1000,
  ttl: 1000 * 60 * 60, // 1 hour
  updateAgeOnGet: true,
  updateAgeOnHas: true,
  // P1-FIX: Add size calculation and maxSize for proper memory management
  maxSize: 100 * 1024 * 1024, // 100MB total cache limit
  sizeCalculation: (jobs) => calculateEntrySize(jobs),
  dispose: (value, _key) => {
  // P1-FIX: Proper cleanup for large array values
  if (value && Array.isArray(value)) {
    value.length = 0; // Clear array to help GC
  }
  },
});

/**
* Cache for publishing job status lookups
*/
export class PublishingStatusCache {
  constructor(private pool: Pool) {}

  /**
  * List jobs for a domain with caching
  * @param domainId - The domain ID to query
  * @param limit - Maximum number of jobs to return (default: 100, max: 1000)
  * @returns Array of job records
  */
  async listJobs(domainId: string, limit: number = 100): Promise<JobCacheEntry[]> {
  if (!domainId || typeof domainId !== 'string') {
    throw new Error('Valid domainId is required');
  }

  // P1-FIX: Validate and clamp limit parameter
  const safeLimit = Math.min(Math.max(1, limit), MAX_JOBS_PER_DOMAIN);
  const key = `publishing:${domainId}:limit:${safeLimit}`;
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  // P1-FIX: Add LIMIT to prevent unbounded queries
  const { rows } = await this.pool.query(
    'SELECT id, status, created_at FROM publishing_jobs WHERE domain_id=$1 ORDER BY created_at DESC LIMIT $2',
    [domainId, safeLimit]
  );
  cache.set(key, rows);
  return rows;
  }

  /**
  * Invalidate cache for a domain
  * @param domainId - The domain ID to invalidate
  */
  invalidate(domainId: string): void {
  if (!domainId || typeof domainId !== 'string') {
    return;
  }
  cache.delete(`publishing:${domainId}`);
  }

  /**
  * Clear entire cache (useful for testing)
  */
  clear(): void {
  cache["clear"]();
  }
}
