import { Pool, PoolClient } from 'pg';
import { randomUUID } from 'crypto';

import type { PublishTargetType } from '@packages/types/publishing';
import type { PublishingStatus } from '@domain/publishing/domain/entities/PublishingJob';

/**
* Publish target record
*/
export interface PublishTarget {
  id: string;
  type: PublishTargetType;
  enabled: boolean;
  created_at: Date;
}

/**
* Publishing job record
*/
export interface PublishingJobRecord {
  id: string;
  content_id: string;
  target_id: string;
  status: PublishingStatus;
  created_at: Date;
  published_at: Date | null;
}

/**
* Create target result
*/
export interface CreateTargetResult {
  id: string;
}

/**
* Retry job result
*/
export interface RetryJobResult {
  ok: boolean;
}

export class PublishingUIService {
  constructor(private pool: Pool) {}

  /**
  * List publish targets for a domain
  * @param domainId - Domain ID
  * @returns Promise resolving to array of publish targets
  */
  async listTargets(domainId: string): Promise<PublishTarget[]> {
  const { rows } = await this.pool.query(
    'SELECT id, type, enabled, created_at FROM publish_targets WHERE domain_id=$1',
    [domainId]
  );
  return rows;
  }

  /**
  * Create a new publish target
  * @param domainId - Domain ID
  * @param type - Target type
  * @param config - Target configuration
  * @returns Promise resolving to create result
  */
  async createTarget(domainId: string, type: PublishTargetType, config: unknown): Promise<CreateTargetResult> {
  const id = randomUUID();
  await this.pool.query(
    `INSERT INTO publish_targets (id, domain_id, type, config)
    VALUES ($1,$2,$3,$4)`,
    [id, domainId, type, JSON.stringify(config)]
  );
  return { id };
  }

  /**
  * List publishing jobs for a domain
  * @param domainId - Domain ID
  * @param limit - Maximum number of jobs to return (default: 100, max: 1000)
  * @returns Promise resolving to array of publishing jobs
  */
  async listJobs(domainId: string, limit: number = 100): Promise<PublishingJobRecord[]> {
  const MAX_LIMIT = 1000;
  const safeLimit = Math.min(Math.max(1, limit), MAX_LIMIT);
  const { rows } = await this.pool.query(
    `SELECT id, content_id, target_id, status, created_at, published_at
    FROM publishing_jobs
    WHERE domain_id=$1
    ORDER BY created_at DESC
    LIMIT $2`,
    [domainId, safeLimit]
  );
  return rows;
  }

  /**
  * Get a publishing job by ID
  * @param jobId - Job ID
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to job record or undefined
  */
  async getJob(jobId: string, client?: Pool | PoolClient): Promise<PublishingJobRecord | undefined> {
  const db = client || this.pool;
  const { rows } = await db.query(
    `SELECT * FROM publishing_jobs WHERE id=$1`,
    [jobId]
  );
  return rows[0];
  }

  /**
  * Retry a failed publishing job
  * @param jobId - Job ID
  * @returns Promise resolving to retry result
  */
  async retryJob(jobId: string): Promise<RetryJobResult> {
  await this.pool.query(
    `UPDATE publishing_jobs SET status='pending' WHERE id=$1`,
    [jobId]
  );
  return { ok: true };
  }
}
