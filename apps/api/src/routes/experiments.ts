import { z } from 'zod';
import { getDb } from '../db';
import { csrfProtection } from '../middleware/csrf';
import { apiRateLimit } from '../middleware/rateLimiter';
import { extractAndVerifyToken } from '@security/jwt';
import { FastifyInstance, FastifyReply, FastifyRequest as FRequest, HookHandlerDoneFunction } from 'fastify';
import { validateExperiment } from '../domain/experiments/validateExperiment';
import type { FastifyRequest } from 'fastify';
import { getLogger } from '@kernel/logger';
import { errors } from '@errors/responses';
import { getErrorMessage, ValidationError } from '@errors';
import { ZodError } from 'zod';

const logger = getLogger('ExperimentService');

const ExperimentVariantSchema = z.object({
  intent: z.string().min(1).max(100),
  contentType: z.string().min(1).max(100),
  name: z.string().max(200).optional(),
  weight: z.number().min(0).max(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const ExperimentBodySchema = z.object({
  domain_id: z.string().uuid('Domain ID must be a valid UUID'),
  variants: z.array(ExperimentVariantSchema).min(1, 'At least one variant is required').max(20),
}).strict();

async function verifyAuth(req: FastifyRequest) {
  const authHeader = req.headers.authorization;
  const result = extractAndVerifyToken(authHeader);
  if (!result.valid || !result.claims) return null;
  const claims = result.claims;
  if (!claims.sub || !claims.orgId) return null;
  return { userId: claims.sub, orgId: claims.orgId };
}

async function canAccessDomain(userId: string, domainId: string, orgId: string): Promise<boolean> {
  // P1-2 FIX: Remove try/catch — let DB errors propagate as 5xx, not silent 403.
  // Previously a transient DB failure returned false → HTTP 403, masking the real outage.
  const db = await getDb();
  const row = await db('domain_registry')
    .join('memberships', 'memberships.org_id', 'domain_registry.org_id')
    .where('domain_registry.domain_id', domainId)
    .where('memberships.user_id', userId)
    .where('domain_registry.org_id', orgId)
    .select('memberships.role')
    // P2-13 FIX: Add query timeout to prevent connection pool starvation.
    .timeout(10000)
    .first();
  return !!row;
}

async function recordAuditEvent(params: AuditEventParams): Promise<void> {
  try {
    const db = await getDb();
    await db('audit_events').insert({
      org_id: params.orgId,
      actor_type: 'user',
      actor_id: params.userId,
      action: params.action,
      entity_type: params.entityType,
      entity_id: params.entityId || null,
      metadata: params.metadata ? JSON.stringify(params.metadata) : null,
      ip_address: params['ip'],
      created_at: new Date(),
    });
  } catch (error) {
    // P1-10 FIX: Use getErrorMessage instead of `error as Error` cast.
    // Non-fatal for experiment audit — log and continue (unlike financial exports).
    logger.error('Failed to record audit event', new Error(getErrorMessage(error)));
  }
}

export async function experimentRoutes(app: FastifyInstance) {
  app.addHook('onRequest', csrfProtection() as (req: FRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void);
  app.addHook('onRequest', apiRateLimit() as (req: FRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void);

  app.post('/experiments', async (req, reply) => {
    const ip = req.ip ?? req.socket?.remoteAddress ?? 'unknown';

    const auth = await verifyAuth(req);
    if (!auth) {
      return errors.unauthorized(reply, 'Unauthorized. Bearer token required.');
    }
    try {
      const parseResult = ExperimentBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        return errors.validationFailed(reply, parseResult.error.issues);
      }
      const { domain_id, variants } = parseResult.data;

      const hasAccess = await canAccessDomain(auth.userId, domain_id, auth.orgId);
      if (!hasAccess) {
        logger.warn('Unauthorized experiment access attempt', { userId: auth.userId, domainId: domain_id });
        return errors.forbidden(reply, 'Access denied to domain');
      }

      // P1-4 FIX: validateExperiment now throws ValidationError (not plain Error).
      // Previously all domain-rule violations were caught here and returned as HTTP 500,
      // inflating 5xx metrics with client-side errors.
      validateExperiment(variants);

      await recordAuditEvent({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'experiment_validated',
        entityType: 'experiment',
        metadata: { domain_id, variant_count: variants.length },
        ip,
      });
      return { status: 'validated' };
    } catch (error) {
      // P1-4 FIX: Route ValidationError to HTTP 400, not 500.
      if (error instanceof ValidationError) {
        return errors.validationFailed(reply, [{ message: error.message, code: 'custom', path: [] }]);
      }
      // P1-FIX: ZodError from validateExperiment (VariantsSchema.parse) must also
      // return HTTP 400, not 500. The route-level Zod schema accepts contentType
      // as any string, but validateExperiment's internal schema enforces an enum.
      // An invalid contentType value throws ZodError which is a client error.
      if (error instanceof ZodError) {
        return errors.validationFailed(reply, error.issues.map(i => ({
          message: i.message,
          code: 'custom' as const,
          path: i.path,
        })));
      }
      // P1-10 FIX: Use getErrorMessage instead of `error as Error` cast.
      logger.error('Error processing experiment request', new Error(getErrorMessage(error)));
      return errors.internal(reply);
    }
  });
}

export interface AuditEventParams {
  orgId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip: string;
}
