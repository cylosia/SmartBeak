
// Validation schemas

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { PublishingUIService } from '../../services/publishing-ui';
import { rateLimit } from '../../services/rate-limit';

const logger = getLogger('publishing-routes');
import { requireRole } from '../../services/auth';
import { getAuthContext } from '../types';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';

const TargetBodySchema = z.object({
  type: z.enum(['wordpress', 'webhook', 'api']),
  config: z.record(z.string(), z.unknown()),
}).strict();

const IdParamSchema = z.object({
  id: z.string().uuid(),
});

const DomainQuerySchema = z.object({
  domainId: z.string().uuid(),
});

export async function publishingRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const svc = new PublishingUIService(pool);

  app.get('/publishing/targets', async (req, res) => {
  try {
    await rateLimit('publishing', 50, req, res);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin', 'editor']);

    const queryResult = DomainQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return errors.badRequest(res, 'Domain ID is required', ErrorCodes.MISSING_PARAMETER);
    }

    // P1-FIX: await so rejections are caught by the try-catch above
    return await svc.listTargets(queryResult.data.domainId);
  } catch (error) {
    logger.error('[publishing/targets] Error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res);
  }
  });

  app.post('/publishing/targets', async (req, res) => {
  try {
    await rateLimit('publishing', 30, req, res);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin']);

    const queryResult = DomainQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return errors.badRequest(res, 'Domain ID is required', ErrorCodes.MISSING_PARAMETER);
    }

    const bodyResult = TargetBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return errors.validationFailed(res, bodyResult["error"].issues);
    }

    const { type, config } = bodyResult.data;
    // P1-FIX: await so rejections are caught by the try-catch above
    return await svc.createTarget(queryResult.data.domainId, type, config);
  } catch (error) {
    logger.error('[publishing/targets] Create error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res);
  }
  });

  app.get('/publishing/jobs', async (req, res) => {
  try {
    await rateLimit('publishing', 50, req, res);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin', 'editor']);

    const queryResult = DomainQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return errors.badRequest(res, 'Domain ID is required', ErrorCodes.MISSING_PARAMETER);
    }

    // P1-FIX: await so rejections are caught by the try-catch above
    return await svc.listJobs(queryResult.data.domainId);
  } catch (error) {
    logger.error('[publishing/jobs] Error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res);
  }
  });

  // P1-FIX: Add try-catch — without it any throw (requireRole, rateLimit,
  // getJobWithOwnership) propagates unhandled, skips structured logging,
  // and may leak stack traces.
  app.get('/publishing/jobs/:id', async (req, res) => {
  try {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin', 'editor']);
    await rateLimit('publishing', 50);

    const paramsResult = IdParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.badRequest(res, 'Invalid job ID', ErrorCodes.INVALID_PARAMS);
    }

    const { id } = paramsResult.data;

    const job = await getJobWithOwnership(pool, svc, id, ctx["orgId"]);
    if (!job) {
    return errors.notFound(res, 'Job');
    }

    if (!job.hasAccess) {
    return errors.forbidden(res, 'Access denied', ErrorCodes.ACCESS_DENIED);
    }

    // Return job without the internal hasAccess flag
    const { hasAccess: _, ...jobData } = job;
    return jobData;
  } catch (error) {
    logger.error('[publishing/jobs/:id] Error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res);
  }
  });

  // P1-FIX: Add try-catch — same issue as GET handler above.
  app.post('/publishing/jobs/:id/retry', async (req, res) => {
  try {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin']);
    await rateLimit('publishing', 30);

    const paramsResult = IdParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
    return errors.badRequest(res, 'Invalid job ID', ErrorCodes.INVALID_PARAMS);
    }

    const { id } = paramsResult.data;

    const hasAccess = await verifyJobOwnership(pool, id, ctx["orgId"]);
    if (!hasAccess) {
    return errors.forbidden(res, 'Access denied', ErrorCodes.ACCESS_DENIED);
    }

    return await svc.retryJob(id);
  } catch (error) {
    logger.error('[publishing/jobs/:id/retry] Error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res);
  }
  });
}

/**
* Verify job ownership
*/
async function verifyJobOwnership(pool: Pool, jobId: string, orgId: string): Promise<boolean> {
  const { rows } = await pool.query(
  `SELECT 1 FROM publishing_jobs pj
  JOIN domains d ON pj.domain_id = d.id
  WHERE pj.id = $1 AND d.org_id = $2`,
  [jobId, orgId]
  );
  return rows.length > 0;
}

/**
* Get job with ownership check in a single atomic operation
* Prevents race condition between getJob and verifyJobOwnership
*/
async function getJobWithOwnership(
  pool: Pool,
  svc: PublishingUIService,
  jobId: string,
  orgId: string
): Promise<Record<string, unknown> & { hasAccess: boolean } | null> {
  const client = await pool.connect();
  try {
  await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
  await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

  // Get job data
  const job = await svc.getJob(jobId, client);
  if (!job) {
    await client.query('ROLLBACK');
    return null;
  }

  // Verify ownership within same transaction
  const { rows } = await client.query(
    `SELECT 1 FROM publishing_jobs pj
    JOIN domains d ON pj.domain_id = d.id
    WHERE pj.id = $1 AND d.org_id = $2`,
    [jobId, orgId]
  );

  await client.query('COMMIT');

  return {
    ...job,
    hasAccess: rows.length > 0,
  };
  } catch (error) {
  await client.query('ROLLBACK');
  throw error;
  } finally {
  client.release();
  }
}
