import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { AlertService } from '../../services/alerts';
import { FlagService } from '../../services/flags';
import { getAuthContext } from '../types';
import { requireRole } from '../../services/auth';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';

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
  .safe('Threshold must be a safe number'),
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
  return { ok: true, key };
  });

  // POST /alerts - Create an alert
  app.post('/alerts', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin']);

  // Validate orgId
  if (!ctx?.["orgId"]) {
    return errors.badRequest(res, 'Organization ID is required', ErrorCodes.MISSING_PARAMETER);
  }

  const orgIdResult = z.string().uuid().safeParse(ctx["orgId"]);
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

  // GET /alerts - List alerts for organization
  app.get('/alerts', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin']);

  // Validate orgId
  if (!ctx?.["orgId"]) {
    return errors.badRequest(res, 'Organization ID is required', ErrorCodes.MISSING_PARAMETER);
  }

  const orgIdResult = z.string().uuid().safeParse(ctx["orgId"]);
  if (!orgIdResult.success) {
    return errors.badRequest(res, 'Invalid organization ID');
  }

  const alertList = await alerts.getActiveAlerts(ctx["orgId"]);
  return { alerts: alertList };
  });
}
