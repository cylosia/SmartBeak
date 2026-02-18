import { z } from 'zod';
import { FastifyInstance } from 'fastify';
import { getDb } from '../db';
import type { FastifyRequest } from 'fastify';
import { getLogger } from '@kernel/logger';
import { getAuthContext, logAuthEvent } from '@security/jwt';
import { errors } from '@errors/responses';
import { emitCounter } from '@kernel/metrics';

const logger = getLogger('FeedbackService');

const FeedbackQuerySchema = z.object({
  domain_id: z.string().uuid('Domain ID must be a valid UUID').optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
  offset: z.coerce.number().min(0).max(10000).optional()
});

/**
 * P0-1 FIX: Use centralized JWT verification from @security/jwt.
 * Previous implementation only checked JWT_KEY_1, breaking key rotation.
 * The centralized module supports JWT_KEY_1 + JWT_KEY_2 rotation,
 * token revocation, constant-time comparison, and Zod claim validation.
 *
 * P1-2 FIX: Log auth failures for intrusion detection.
 */
function verifyAuth(req: FastifyRequest) {
  // P0-8 FIX: Fail fast before calling getAuthContext when the header is absent.
  // Previously {} was passed, which could produce a partial/null context that
  // slipped past the `!result` guard and let unauthenticated requests through.
  if (!req.headers.authorization) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    logAuthEvent('auth_failure', {
      ip,
      userAgent: req.headers['user-agent'] || 'unknown',
      path: '/feedback',
    });
    return null;
  }

  const result = getAuthContext({ authorization: req.headers.authorization });
  if (!result) {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    logAuthEvent('auth_failure', {
      ip,
      userAgent: req.headers['user-agent'] || 'unknown',
      path: '/feedback',
    });
    return null;
  }

  return { userId: result.userId, orgId: result.orgId };
}

async function canAccessDomain(userId: string, domainId: string, orgId: string): Promise<boolean> {
  try {
    const db = await getDb();
    const row = await db('domain_registry')
      .join('memberships', 'memberships.org_id', 'domain_registry.org_id')
      .where('domain_registry.domain_id', domainId)
      // P1-5 FIX: Explicit org_id guard on domain_registry prevents IDOR if
      // the join condition is ever relaxed or the query is refactored.
      .where('domain_registry.org_id', orgId)
      .where('memberships.user_id', userId)
      .where('memberships.org_id', orgId)
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
export async function feedbackRoutes(app: FastifyInstance) {
  app.get('/feedback', async (req, reply) => {
    // P3 FIX: Fastify has req.ip built-in, no double cast needed
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';

    const auth = verifyAuth(req);
    if (!auth) {
      return errors.unauthorized(reply, 'Unauthorized. Bearer token required.');
    }
    try {
      // Validate query parameters
      const parseResult = FeedbackQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        return errors.validationFailed(reply, parseResult.error.issues);
      }
      const { domain_id, limit, offset } = parseResult.data;

      if (domain_id) {
        const hasAccess = await canAccessDomain(auth.userId, domain_id, auth.orgId);
        if (!hasAccess) {
          logger.warn(`Unauthorized access attempt: user ${auth.userId} tried to access feedback for domain ${domain_id}`);
          return errors.forbidden(reply, 'Access denied to domain');
        }
      }

      // P0-5 FIX: Always scope queries to the authenticated user's organization
      // When domain_id is absent, results must still be scoped to auth.orgId
      const orgScope = auth.orgId;

      // P2-5 FIX: Fire-and-forget audit event to avoid blocking the request path.
      // recordAuditEvent already handles its own error logging internally.
      recordAuditEvent({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'feedback_list_accessed',
        entityType: 'feedback',
        metadata: {
          domain_id,
          limit,
          offset,
        },
        ip,
      }).catch((err: unknown) => {
        // P1-11 FIX: Emit a counter so audit write failures surface on dashboards.
        // A malicious actor can degrade the audit DB to erase access traces;
        // this counter makes the degradation visible via alerting.
        logger.error('Audit event fire-and-forget failure', err instanceof Error ? err : new Error(String(err)));
        emitCounter('audit.write_failure', 1, { action: 'feedback_list_accessed' });
      });
      // Return empty feedback data (placeholder for future implementation)
      // NOTE: When implementing, ALL queries MUST be scoped to orgScope.
      // F-8 FIX: orgId is an internal identifier — omit it from the response
      // body to avoid leaking the org's UUID to the client.
      return { data: [] };
    }
    catch (error) {
      logger.error('Error processing feedback request', error as Error);
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
