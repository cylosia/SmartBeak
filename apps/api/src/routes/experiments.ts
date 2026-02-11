import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { getDb } from '../db';
import { csrfProtection } from '../middleware/csrf';
import { sanitizeError } from '../utils/sanitizedErrors';
import { FastifyInstance, FastifyReply } from 'fastify';
import { validateExperiment } from '../domain/experiments/validateExperiment';
import type { FastifyRequest } from 'fastify';
import type { JwtPayload } from 'jsonwebtoken';
import { getLogger } from '../../../../packages/kernel/logger';

const logger = getLogger('ExperimentService');

const ExperimentBodySchema = z.object({
  domain_id: z.string().uuid('Domain ID must be a valid UUID'),
  variants: z.array(z.any()).min(1, 'At least one variant is required')
});
async function verifyAuth(req: FastifyRequest) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7);
  try {
    const jwtKey = process.env['JWT_KEY_1'];
    if (!jwtKey) {
      logger.error('JWT_KEY_1 not configured');
      return null;
    }

    const claims = jwt.verify(token, jwtKey, {
      audience: process.env['JWT_AUDIENCE'] || 'smartbeak',
      issuer: process.env['JWT_ISSUER'] || 'smartbeak-api',
      algorithms: ['HS256'],
      clockTolerance: 30, // SECURITY FIX: Allow 30 seconds clock skew
    }) as JwtPayload & { sub?: string; orgId?: string };
    if (!claims.sub || !claims.orgId) {
      return null;
    }
    return { userId: claims.sub, orgId: claims.orgId };
  }
  catch (err) {
    return null;
  }
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
