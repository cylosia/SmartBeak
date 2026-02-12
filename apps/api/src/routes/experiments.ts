import { z } from 'zod';
import { getDb } from '../db';
import { csrfProtection } from '../middleware/csrf';
import { apiRateLimit } from '../middleware/rateLimiter';
import { sanitizeError } from '../utils/sanitizedErrors';
import { extractAndVerifyToken } from '@security/jwt';
import { FastifyInstance, FastifyReply, FastifyRequest as FRequest, HookHandlerDoneFunction } from 'fastify';
import { validateExperiment } from '../domain/experiments/validateExperiment';
import type { FastifyRequest } from 'fastify';
import { getLogger } from '../../../../packages/kernel/logger';

const logger = getLogger('ExperimentService');

// P1-SECURITY FIX: Replace z.any() with proper variant schema to prevent unconstrained data injection
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
});
// P1-SECURITY FIX: Use centralized @security/jwt instead of raw jwt.verify
// Ensures consistent key rotation, clockTolerance, and timing-safe token comparison
async function verifyAuth(req: FastifyRequest) {
  const authHeader = req.headers.authorization;
  const result = extractAndVerifyToken(authHeader);

  if (!result.valid || !result.claims) {
    return null;
  }

  const claims = result.claims;
  if (!claims.sub || !claims.orgId) {
    return null;
  }

  return { userId: claims.sub, orgId: claims.orgId };
}

async function canAccessDomain(userId: string, domainId: string, orgId: string) {
  try {
    const db = await getDb();
    const row = await db('domain_registry')
      .join('memberships', 'memberships.org_id', 'domain_registry.org_id')
      .where('domain_registry.domain_id', domainId)
      .where('memberships.user_id', userId)
      .where('domain_registry.org_id', orgId)
      .select('memberships.role')
      .first();
    return !!row;
  }
  catch (error) {
    logger.error('Error checking domain access', error as Error);
    return false;
  }
}
async function recordAuditEvent(params: AuditEventParams) {
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
      ip_address: params["ip"],
      created_at: new Date(),
    });
  }
  catch (error) {
    logger.error('Failed to record audit event', error as Error);
  }
}
export async function experimentRoutes(app: FastifyInstance) {
  // P1-SECURITY FIX: Add CSRF protection for state-changing operations
  app.addHook('onRequest', csrfProtection() as (req: FRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void);
  // P1-SECURITY FIX: Add rate limiting to prevent resource exhaustion
  app.addHook('onRequest', apiRateLimit() as (req: FRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void);

  app.post('/experiments', async (req, reply) => {
    const ip = (req as unknown as { ip?: string }).ip || req.socket?.remoteAddress || 'unknown';

    const auth = await verifyAuth(req);
    if (!auth) {
      return reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
    }
    try {
      // Validate input
      const parseResult = ExperimentBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid input',
          details: parseResult.error.issues
        });
      }
      const { domain_id, variants } = parseResult.data;

      const hasAccess = await canAccessDomain(auth.userId, domain_id, auth.orgId);
      if (!hasAccess) {
        logger.warn(`Unauthorized access attempt: user ${auth.userId} tried to create experiment for domain ${domain_id}`);
        return reply.status(403).send({ error: 'Access denied to domain' });
      }
      validateExperiment(variants);

      await recordAuditEvent({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'experiment_validated',
        entityType: 'experiment',
        metadata: {
          domain_id,
          variant_count: variants.length,
        },
        ip,
      });
      return { status: 'validated' };
    }
    catch (error) {
      logger.error('Error processing experiment request', error as Error);
      return reply.status(500).send({
        error: 'Internal server error',
        ...(process.env['NODE_ENV'] === 'development' && { message: (error as Error)["message"] })
      });
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
