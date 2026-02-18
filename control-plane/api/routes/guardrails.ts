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

// Env-based feature flags (from @config/features) are intentionally NOT imported here.
// Env flags reflect internal platform topology and must not be enumerable by tenant-level
// roles (owner/admin). Use a super-admin endpoint if needed.

const logger = getLogger('guardrailRoutes');

// Hoist per-request Zod schemas to module scope to avoid per-call allocation
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
  .min(0, 'Threshold must be non-negative'),
});

export async function guardrailRoutes(app: FastifyInstance, pool: Pool) {
  const flags = new FlagService(pool);
  const alerts = new AlertService(pool);

  // POST /admin/flags/:key - Set a feature flag (scoped to the authenticated org)
  app.post('/admin/flags/:key', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner']);

  // SEC FIX (P0): Validate and bind orgId so flag writes are scoped to the caller's
  // tenant. Before this fix, flags were global (no org_id column in system_flags),
  // meaning any org-level 'owner' could toggle platform-wide feature flags.
  if (!ctx['orgId']) {
    return errors.badRequest(res, 'Organization ID is required', ErrorCodes.MISSING_PARAMETER);
  }
  const orgIdResult = OrgIdSchema.safeParse(ctx['orgId']);
  if (!orgIdResult.success) {
    return errors.badRequest(res, 'Invalid organization ID', ErrorCodes.VALIDATION_ERROR, orgIdResult['error'].issues);
  }

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
  const orgId = orgIdResult.data;

  // Capture previous value for audit trail before mutating
  const previousValue = await flags.isEnabled(key, orgId);
  await flags.set(key, value, orgId);

  // Structured audit log with before/after values for incident post-mortems and SOC2 compliance
  logger.info('feature_flag_set', {
    userId: ctx['userId'],
    orgId,
    flagKey: key,
    previousValue,
    newValue: value,
  });

  return { ok: true, key };
  });

  // POST /alerts - Create an alert
  app.post('/alerts', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin']);

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

  if (!ctx['orgId']) {
    return errors.badRequest(res, 'Organization ID is required', ErrorCodes.MISSING_PARAMETER);
  }
  const orgIdResult = OrgIdSchema.safeParse(ctx['orgId']);
  if (!orgIdResult.success) {
    return errors.badRequest(res, 'Invalid organization ID', ErrorCodes.VALIDATION_ERROR, orgIdResult['error'].issues);
  }

  // Validate params
  const paramsResult = FeatureFlagParamsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return errors.badRequest(res, 'Invalid flag key', ErrorCodes.VALIDATION_ERROR, paramsResult["error"].issues);
  }

  const { key } = paramsResult.data;
  const value = await flags.isEnabled(key, orgIdResult.data);
  return { key, value };
  });

  // GET /admin/flags - List database-backed feature flags for this tenant only.
  // Env-based flags (from @config/features) are intentionally excluded because they
  // reflect internal platform topology and must not be enumerable by tenant roles.
  app.get('/admin/flags', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin']);

  if (!ctx['orgId']) {
    return errors.badRequest(res, 'Organization ID is required', ErrorCodes.MISSING_PARAMETER);
  }
  const orgIdResult = OrgIdSchema.safeParse(ctx['orgId']);
  if (!orgIdResult.success) {
    return errors.badRequest(res, 'Invalid organization ID', ErrorCodes.VALIDATION_ERROR, orgIdResult['error'].issues);
  }

  const dbFlags = await flags.getAll(orgIdResult.data);

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

  if (!ctx["orgId"]) {
    return errors.badRequest(res, 'Organization ID is required', ErrorCodes.MISSING_PARAMETER);
  }

  const orgIdResult = OrgIdSchema.safeParse(ctx["orgId"]);
  if (!orgIdResult.success) {
    return errors.badRequest(res, 'Invalid organization ID', ErrorCodes.VALIDATION_ERROR, orgIdResult["error"].issues);
  }

  const alertList = await alerts.getActiveAlerts(ctx["orgId"]);
  return { alerts: alertList };
  });
}
