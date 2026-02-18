import { Pool } from 'pg';
import { randomUUID } from 'crypto';

import { NotFoundError } from '@errors';
import { getLogger } from '@kernel/logger';

const logger = getLogger('publishing-create-job');



/**
* Publishing job creation input
*/
export interface PublishingJobInput {
  domainId: string;
  contentId: string;
  targetId: string;
  scheduleAt?: string;
}

/**
* Publishing job creation result
*/
export interface PublishingJobResult {
  id: string;
  status: 'pending';
}

export class PublishingCreateJobService {
  constructor(private pool: Pool) {}

  /**
  * Create a publishing job
  * to prevent race conditions and ensure atomicity
  *
  * @param input - Job creation input
  * @returns Promise resolving to job creation result
  */
  async createJob(input: PublishingJobInput): Promise<PublishingJobResult> {
  const client = await this.pool.connect();

  try {
    // This ensures the validation checks remain valid throughout the transaction
    await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

    // P0-FIX: Scope content lookup to the caller's domain to prevent IDOR.
    // The previous `WHERE id=$1` let any authenticated user create a publishing
    // job for content belonging to another org by guessing its UUID.
    // The domain_id constraint enforces ownership at the DB layer.
    const content = await client.query(
    'SELECT id FROM content_items WHERE id=$1 AND domain_id=$2',
    [input.contentId, input.domainId]
    );
    if (!content.rows[0]) {
    throw NotFoundError.content();
    }

    // P2-FIX: Remove redundant pre-catch ROLLBACK calls. The catch block
    // unconditionally rolls back, so explicit ROLLBACKs before each throw
    // caused a double-rollback (harmless in pg but structurally wrong).
    // Validate target exists
    const target = await client.query(
    'SELECT id, type, config, region FROM publish_targets WHERE id=$1 AND domain_id=$2',
    [input.targetId, input.domainId]
    );
    if (!target.rows[0]) {
    throw new NotFoundError('Publish target');
    }

    const jobId = randomUUID();

    await client.query(
    `INSERT INTO publishing_jobs
    (id, domain_id, content_id, target_id, status, region, created_at)
    VALUES ($1,$2,$3,$4,'pending',$5,now())`,
    [
    jobId,
    input.domainId,
    input.contentId,
    input.targetId,
    target.rows[0].region
    ]
    );

    await client.query('COMMIT');

    return {
    id: jobId,
    status: 'pending'
    };
  } catch (error) {

    try {
    await client.query('ROLLBACK');
    } catch (rollbackError: unknown) {
    // H6-FIX: Log rollback failure so operators can detect connection issues.
    logger.error('Transaction rollback failed', rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
    }
    throw error;
  } finally {
    client.release();
  }
  }
}
