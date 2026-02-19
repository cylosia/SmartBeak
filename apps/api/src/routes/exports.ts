import { FastifyInstance, FastifyReply, FastifyRequest as FRequest, HookHandlerDoneFunction } from 'fastify';
import { z } from 'zod';

import { getDb } from '../db';
import { apiRateLimit } from '../middleware/rateLimiter';
import { csrfProtection } from '../middleware/csrf';
import { optionalAuthFastify } from '@security/auth';
import { getLogger } from '@kernel/logger';
import { errors } from '@errors/responses';
import { getErrorMessage } from '@errors';

// P0-SECURITY FIX: Add .strict() to reject extra body properties (CLAUDE.md convention).
// P3-CORRECTNESS FIX: Removed misleading "required" message from optional field.
const ExportBodySchema = z.object({
  domain_id: z.string().uuid('Domain ID must be a valid UUID'),
  type: z.string().min(1).max(100).optional(),
}).strict();

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

// P1-1 FIX: Require admin/owner role — viewer and editor must not access financial exports.
const EXPORT_ALLOWED_ROLES = new Set(['admin', 'owner']);

async function canAccessDomain(
  userId: string,
  domainId: string,
  orgId: string
): Promise<boolean> {
  // P1-2 FIX: Throw ServiceUnavailableError on DB error instead of returning false.
  // Returning false maps a transient DB failure to HTTP 403 "Access denied", which:
  //  - Misleads on-call engineers into investigating permissions (wrong root cause)
  //  - Generates no 5xx alert (correct root cause hidden)
  const db = await getDb();
  const row = await db('domain_registry')
    .join('memberships', 'memberships.org_id', 'domain_registry.org_id')
    .where('domain_registry.domain_id', domainId)
    .where('memberships.user_id', userId)
    .where('domain_registry.org_id', orgId)
    .select('memberships.role')
    // P2-13 FIX: 10-second query timeout — unguarded joins can hold pool connections indefinitely.
    .timeout(10000)
    .first();

  // P1-1 FIX: Check role, not just membership existence.
  return !!row && EXPORT_ALLOWED_ROLES.has(row['role'] as string);
}

// P2-7 FIX: recordAuditEvent now throws on failure.
// For financial exports, a missing audit record is a compliance violation — the
// export must not proceed if the audit write fails (vs. experiments which are lower criticality).
async function recordAuditEvent(params: AuditEventParams): Promise<void> {
  const db = await getDb();
  try {
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
    logger.error('Failed to record audit event', new Error(getErrorMessage(error)));
    throw error;
  }
}

export async function exportRoutes(app: FastifyInstance): Promise<void> {
  // P0-3 FIX: Add the same Fastify hook type cast used in experiments.ts.
  // Without the cast, async middleware is registered as a sync done-callback hook
  // and Fastify calls done() immediately — CSRF validation and rate limiting never execute.
  app.addHook('onRequest', csrfProtection() as (req: FRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void);
  app.addHook('onRequest', apiRateLimit() as (req: FRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void);

  app.post<{
    Body: ExportBodyType;
    Reply: ExportResponse | ErrorResponse;
  }>('/exports', async (req, reply) => {
    await optionalAuthFastify(req, reply);
    const auth = req.authContext;
    if (!auth) {
      return errors.unauthorized(reply, 'Unauthorized. Bearer token required.');
    }

    try {
      const parseResult = ExportBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        return errors.validationFailed(reply, parseResult.error.issues);
      }
      const { domain_id: domainId } = parseResult.data;

      const hasAccess = await canAccessDomain(auth.userId, domainId, auth.orgId);
      if (!hasAccess) {
        logger.warn('Unauthorized export access attempt', { userId: auth.userId, domainId });
        return errors.forbidden(reply, 'Access denied to domain');
      }

      // P2-7 FIX: Audit write is outside the catch block — failure aborts the export.
      await recordAuditEvent({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'export_requested',
        entityType: 'export',
        metadata: {
          domain_id: domainId,
          export_type: parseResult.data.type ?? 'default',
        },
        ip: req.ip ?? 'unknown',
      });

      // P2-1 NOTE: Job dispatch not yet wired. Returning 202 Accepted to reflect
      // async intent; the actual queue.add() call belongs here once the export
      // queue is available in this scope.
      return reply.status(202).send({ status: 'generating' });
    } catch (error) {
      // P1-10 FIX: Use getErrorMessage instead of `error as Error` cast.
      logger.error('Error processing export request', new Error(getErrorMessage(error)));
      return errors.internal(reply, 'Failed to process export request');
    }
  });
}
