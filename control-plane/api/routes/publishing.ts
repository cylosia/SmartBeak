
// Validation schemas

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { PublishingUIService } from '../../services/publishing-ui';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, type AuthContext } from '../../services/auth';
import { errors, sendError } from '@errors/responses';
import { ErrorCodes } from '@errors';

const TargetBodySchema = z.object({
  type: z.enum(['wordpress', 'webhook', 'api']),
  config: z.record(z.string(), z.unknown()),
});

const IdParamSchema = z.object({
  id: z.string().uuid(),
});

export async function publishingRoutes(app: FastifyInstance, pool: Pool): Promise<void> {
  const svc = new PublishingUIService(pool);

  app.get('/publishing/targets', async (req, res) => {
  const ctx = req.auth as AuthContext;
  if (!ctx) {
    return errors.unauthorized(res);
  }
  requireRole(ctx, ['owner', 'admin', 'editor']);
  await rateLimit('publishing', 50);

  if (!ctx["domainId"]) {
    return errors.badRequest(res, 'Domain ID is required', ErrorCodes.MISSING_PARAMETER);
  }

  return svc.listTargets(ctx["domainId"]);
  });

  app.post('/publishing/targets', async (req, res) => {
  const ctx = req.auth as AuthContext;
  if (!ctx) {
    return errors.unauthorized(res);
  }
  requireRole(ctx, ['owner', 'admin']);
  await rateLimit('publishing', 30);

  if (!ctx["domainId"]) {
    return errors.badRequest(res, 'Domain ID is required', ErrorCodes.MISSING_PARAMETER);
  }

  const bodyResult = TargetBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return errors.validationFailed(res, bodyResult["error"].issues);
  }

  const { type, config } = bodyResult.data;
  return svc.createTarget(ctx["domainId"], type, config);
  });

  app.get('/publishing/jobs', async (req, res) => {
  const ctx = req.auth as AuthContext;
  if (!ctx) {
    return errors.unauthorized(res);
  }
  requireRole(ctx, ['owner', 'admin', 'editor']);
  await rateLimit('publishing', 50);

  if (!ctx["domainId"]) {
    return errors.badRequest(res, 'Domain ID is required', ErrorCodes.MISSING_PARAMETER);
  }

  return svc.listJobs(ctx["domainId"]);
  });

  app.get('/publishing/jobs/:id', async (req, res) => {
  const ctx = req.auth as AuthContext;
  if (!ctx) {
    return errors.unauthorized(res);
  }
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
  });

  app.post('/publishing/jobs/:id/retry', async (req, res) => {
  const ctx = req.auth as AuthContext;
  if (!ctx) {
    return errors.unauthorized(res);
  }
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

  return svc.retryJob(id);
  });
}

/**
* Verify job ownership
*/
async function verifyJobOwnership(pool: Pool, jobId: string, orgId: string): Promise<boolean> {
  const { rows } = await pool.query(
  `SELECT 1 FROM publishing_jobs pj
  JOIN domains d ON pj.domain_id = d["id"]
  WHERE pj["id"] = $1 AND d.org_id = $2`,
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
    JOIN domains d ON pj.domain_id = d["id"]
    WHERE pj["id"] = $1 AND d.org_id = $2`,
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
