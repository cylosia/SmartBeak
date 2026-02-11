import { FastifyInstance, FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { z } from 'zod';

import { getDb } from '../db';
import { apiRateLimit } from '../middleware/rateLimiter';
import { csrfProtection } from '../middleware/csrf';
import { optionalAuthFastify, type FastifyAuthContext } from '@security/auth';
import { sanitizeError } from '../utils/sanitizedErrors';
import { getLogger } from '../../../../packages/kernel/logger';

const ExportBodySchema = z.object({
  domain_id: z.string().uuid('Domain ID must be a valid UUID').optional(),
  type: z.string().min(1, 'Export type is required').optional()
});

type ExportBodyType = z.infer<typeof ExportBodySchema>;

interface ExportResponse {
  status: string;
}

interface ErrorResponse {
  error: string;
  code?: string;
  details?: unknown;
}

const logger = getLogger('ExportService');

export interface AuditEventParams {
  orgId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip: string;
}

async function canAccessDomain(
  userId: string,
  domainId: string,
  orgId: string
): Promise<boolean> {
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
  } catch (error) {
    logger.error('Error checking domain access', error as Error);
    return false;
  }
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
      ip_address: params["ip"],
      created_at: new Date(),
    });
  } catch (error) {
    logger.error('Failed to record audit event', error as Error);
  }
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  // P1-FIX: Add CSRF protection for state-changing operations
  app.addHook('onRequest', csrfProtection() as (req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void);

  app.addHook('onRequest', apiRateLimit() as (req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void);

  app.post<{
    Body: ExportBodyType;
    Reply: ExportResponse | ErrorResponse;
  }>('/exports', async (req, reply) => {
    const ip = req["ip"] || req.socket?.remoteAddress || 'unknown';

    await optionalAuthFastify(req, reply, () => {});
    const auth = req.authContext;
    if (!auth) {
      return reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
    }

    try {
      // Validate input if body is provided
      let domainId: string | undefined;
      if (req.body && Object.keys(req.body).length > 0) {
        const parseResult = ExportBodySchema.safeParse(req.body);
        if (!parseResult.success) {
          return reply.status(400).send({
            error: 'Invalid input',
            code: 'VALIDATION_ERROR',
            details: parseResult.error.issues
          });
        }
        domainId = parseResult.data.domain_id;
      }

      if (domainId) {
        const hasAccess = await canAccessDomain(auth.userId, domainId, auth.orgId);
        if (!hasAccess) {
          logger.warn(`Unauthorized access attempt: user ${auth.userId} tried to export data for domain ${domainId}`);
          return reply.status(403).send({ error: 'Access denied to domain' });
        }
      }

      await recordAuditEvent({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'export_requested',
        entityType: 'export',
        metadata: {
          domain_id: domainId,
          export_type: (req.body as { type?: string })?.type || 'default',
        },
        ip: req.ip || 'unknown',
      });

      return reply.status(200).send({ status: 'generating' });
    } catch (error) {
      // SECURITY FIX: P1-HIGH Issue 2 - Sanitize error messages
      logger.error('Error processing export request', error as Error);
      const sanitized = sanitizeError(error, 'Failed to process export request', 'EXPORT_ERROR');
      return reply.status(500).send(sanitized);
    }
  });
}
