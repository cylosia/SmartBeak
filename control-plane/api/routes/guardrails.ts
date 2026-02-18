import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { AlertService } from '../../services/alerts';
import { FlagService } from '../../services/flags';
import { getAuthContext } from '../types';
import { requireRole } from '../../services/auth';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';
import { getLogger } from '@kernel/logger';

// P0-2: featureFlags (env-level) intentionally NOT imported here.
// Env-based flags reflect internal platform topology and must not be exposed
// to tenant-level roles (owner/admin). Use a super-admin endpoint if needed.

const logger = getLogger('guardrailRoutes');

// P2-10: hoist per-request Zod schemas to module scope to avoid per-call allocation
const OrgIdSchema = z.string().uuid();

const FeatureFlagKeySchema = z.string()
  .min(1, 'Key is required')
  .max(100, 'Key must be 100 characters or less')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Key can only contain letters, numbers, underscores, and hyphens');

const FeatureFlagParamsSchema = z.object({
  key: FeatureFlagKeySchema,
});

const FeatureFlagBodySchema = z.object({
  value: z.boolean(),
});

const AlertBodySchema = z.object({
  metric: z.string()
  .min(1, 'Metric name is required')
  .max(100, 'Metric name must be 100 characters or less')
  .regex(/^[a-zA-Z0-9_.]+$/, 'Metric can only contain letters, numbers, underscores, and dots'),
  threshold: z.number()
  .finite('Threshold must be a finite number')
  .safe('Threshold must be a safe number')
  // P1-11 FIX: reject negative thresholds — a negative threshold causes permanent
  // alert storm or total alert suppression depending on comparison direction.
  .min(0, 'Threshold must be non-negative'),
});

export async function guardrailRoutes(app: FastifyInstance, pool: Pool) {
  const flags = new FlagService(pool);
  const alerts = new AlertService(pool);

  // POST /admin/flags/:key - Set a feature flag
  app.post('/admin/flags/:key', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner']);

  // Validate params
  const paramsResult = FeatureFlagParamsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return errors.badRequest(res, 'Invalid flag key', ErrorCodes.VALIDATION_ERROR, paramsResult["error"].issues);
  }

  // Validate body
  const bodyResult = FeatureFlagBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return errors.badRequest(res, 'Invalid flag value', ErrorCodes.VALIDATION_ERROR, bodyResult["error"].issues);
  }

  const { key } = paramsResult.data;
  const { value } = bodyResult.data;

  await flags.set(key, value);

  // P1-9 FIX: structured audit log — every flag mutation must be attributable
  // for incident post-mortems and SOC2/ISO27001 compliance.
  logger.info('feature_flag_set', {
    userId: ctx['userId'],
    orgId: ctx['orgId'],
    flagKey: key,
    flagValue: value,
  });

  return { ok: true, key };
  });

  // POST /alerts - Create an alert
  app.post('/alerts', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin']);

  // Validate orgId
  // P0-3 FIX: removed dead ctx?.["orgId"] optional-chain. getAuthContext() throws
  // on missing auth so ctx is always non-null here. Validate orgId presence explicitly.
  if (!ctx["orgId"]) {
    return errors.badRequest(res, 'Organization ID is required', ErrorCodes.MISSING_PARAMETER);
  }

  const orgIdResult = OrgIdSchema.safeParse(ctx["orgId"]);
  if (!orgIdResult.success) {
    return errors.badRequest(res, 'Invalid organization ID', ErrorCodes.VALIDATION_ERROR, orgIdResult["error"].issues);
  }

  // Validate body
  const bodyResult = AlertBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return errors.badRequest(res, 'Invalid alert configuration', ErrorCodes.VALIDATION_ERROR, bodyResult["error"].issues);
  }

  const { metric, threshold } = bodyResult.data;
  await alerts.create(ctx["orgId"], metric, threshold);
  return { ok: true, metric, threshold };
  });

  // GET /admin/flags/:key - Get a feature flag value
  app.get('/admin/flags/:key', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin']);

  // Validate params
  const paramsResult = FeatureFlagParamsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return errors.badRequest(res, 'Invalid flag key', ErrorCodes.VALIDATION_ERROR, paramsResult["error"].issues);
  }

  const { key } = paramsResult.data;
  const value = await flags.isEnabled(key);
  return { key, value };
  });

  // GET /admin/flags - List database-backed feature flags for this tenant
  // P0-2 FIX: env-based flags (from @config/features) are intentionally excluded.
  // Env flags reflect internal platform topology and must not be enumerable by
  // tenant-level roles (owner/admin). Only DB-persisted flags — those explicitly
  // set via POST /admin/flags/:key — are returned here.
  app.get('/admin/flags', async (req) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin']);

  const dbFlags = await flags.getAll();

  const result = dbFlags
    .map(dbFlag => ({
    key: dbFlag.key,
    value: dbFlag.value,
    source: 'database' as const,
    updatedAt: dbFlag.updatedAt ? dbFlag.updatedAt.toISOString() : null,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));

  return { flags: result };
  });

  // GET /alerts - List alerts for organization
  app.get('/alerts', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin']);

  // Validate orgId
  if (!ctx["orgId"]) {
    return errors.badRequest(res, 'Organization ID is required', ErrorCodes.MISSING_PARAMETER);
  }

  const orgIdResult = OrgIdSchema.safeParse(ctx["orgId"]);
  if (!orgIdResult.success) {
    // P1-8 FIX: was missing ErrorCodes and Zod issues, making this the only
    // error response in the file with a different shape — breaking API clients.
    return errors.badRequest(res, 'Invalid organization ID', ErrorCodes.VALIDATION_ERROR, orgIdResult["error"].issues);
  }

  const alertList = await alerts.getActiveAlerts(ctx["orgId"]);
  return { alerts: alertList };
  });
}
