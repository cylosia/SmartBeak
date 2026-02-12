import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../db';
import { adminRateLimit } from '../middleware/rateLimiter';
import { isValidUUID } from '../../../../packages/security/input-validator';
import crypto from 'crypto';

/**
 * P0-FIX: Verify the specified organization exists and has active admin membership.
 *
 * SECURITY NOTE: These admin routes use a shared ADMIN_API_KEY (not per-user JWT),
 * so we cannot verify *which* admin is requesting. This function ensures the target
 * org_id is valid and has at least one admin member. For per-user access control,
 * migrate to JWT-based auth on admin routes.
 */
async function verifyAdminOrgAccess(orgId: string): Promise<boolean> {
  const db = await getDb();
  const membership = await db('org_memberships')
    .where({ org_id: orgId })
    .whereIn('role', ['admin', 'owner'])
    .first();
  return !!membership;
}

const ALLOWED_AUDIT_ACTIONS = [
  'create',
  'update',
  'delete',
  'login',
  'logout',
  'export',
  'import',
  'settings_changed',
  'user_invited',
  'user_removed',
  'domain_created',
  'domain_deleted',
  'content_published',
  'content_archived',
  'api_key_generated',
  'buyer_roi_summary_accessed',
] as const;

export type AllowedAuditAction = typeof ALLOWED_AUDIT_ACTIONS[number];

function isAllowedAuditAction(action: string): action is AllowedAuditAction {
  return ALLOWED_AUDIT_ACTIONS.includes(action as AllowedAuditAction);
}

export interface ValidationResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

/**
 * Prevents invalid actions and potential injection attempts
 */
function validateAction(action: string): ValidationResult<AllowedAuditAction> {
  if (!isAllowedAuditAction(action)) {
    return {
      success: false,
      error: `Invalid action: ${action}. Must be one of: ${ALLOWED_AUDIT_ACTIONS.join(', ')}`
    };
  }
  return { success: true, data: action };
}

function isCountResult(value: unknown): value is { count: string | number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'count' in value &&
    (typeof (value as Record<string, unknown>)['count'] === 'string' ||
      typeof (value as Record<string, unknown>)['count'] === 'number')
  );
}

export interface AuditEvent {
  id: string;
  org_id: string;
  actor_type: string;
  actor_id: string;
  action: string;
  entity_type: string;
  entity_id?: string;
  metadata?: string;
  ip_address?: string;
  created_at: Date;
}

function isAuditEvent(value: unknown): value is AuditEvent {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj['id'] === 'string' &&
    typeof obj['org_id'] === 'string' &&
    typeof obj['actor_type'] === 'string' &&
    typeof obj['actor_id'] === 'string' &&
    typeof obj['action'] === 'string' &&
    typeof obj['entity_type'] === 'string' &&
    (obj['entity_id'] === undefined || typeof obj['entity_id'] === 'string') &&
    (obj['metadata'] === undefined || typeof obj['metadata'] === 'string') &&
    (obj['ip_address'] === undefined || typeof obj['ip_address'] === 'string') &&
    obj['created_at'] instanceof Date
  );
}

export async function adminAuditRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (req, reply) => {
    // Check for admin authentication
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
      return;
    }

    const token = authHeader.slice(7);
    try {
      // This should use the shared auth utility
      // For now, we check a simple admin token for protection
      if (!process.env['ADMIN_API_KEY']) {
        reply.status(500).send({ error: 'Admin API not configured' });
        return;
      }
      // P0-FIX: Use constant-time comparison to prevent timing attacks
      // Pad both buffers to max length to avoid leaking key length via early return
      const expectedKey = process.env['ADMIN_API_KEY'];
      const tokenBuf = Buffer.from(token, 'utf8');
      const expectedBuf = Buffer.from(expectedKey, 'utf8');
      const maxLen = Math.max(tokenBuf.length, expectedBuf.length);
      if (maxLen === 0) {
        reply.status(403).send({ error: 'Forbidden. Admin access required.' });
        return;
      }
      const tokenPadded = Buffer.alloc(maxLen, 0);
      const expectedPadded = Buffer.alloc(maxLen, 0);
      tokenBuf.copy(tokenPadded);
      expectedBuf.copy(expectedPadded);
      const isEqual = crypto.timingSafeEqual(tokenPadded, expectedPadded) && tokenBuf.length === expectedBuf.length;

      if (!isEqual) {
        reply.status(403).send({ error: 'Forbidden. Admin access required.' });
        return;
      }
    } catch (err) {
      reply.status(401).send({ error: 'Invalid token' });
      return;
    }
  });

  app.get('/admin/audit', async (req: FastifyRequest, reply: FastifyReply) => {
    try {
      const { orgId, action, from, to } = req.query as {
        orgId?: string;
        action?: string;
        from?: string;
        to?: string;
      };
      const limitParam = (req.query as Record<string, unknown>)['limit'];
      const offsetParam = (req.query as Record<string, unknown>)['offset'];

      // Parse and validate pagination parameters
      const limit = Math.min(Math.max(parseInt(String(limitParam || '50'), 10) || 50, 1), 200);
      const offset = Math.max(parseInt(String(offsetParam || '0'), 10) || 0, 0);

      let fromDate: Date | undefined;
      let toDate: Date | undefined;

      if (from) {
        fromDate = new Date(from);
        if (isNaN(fromDate.getTime())) {
          return reply.status(400).send({ error: 'Invalid from date format' });
        }
      }

      if (to) {
        toDate = new Date(to);
        if (isNaN(toDate.getTime())) {
          return reply.status(400).send({ error: 'Invalid to date format' });
        }
      }

      if (fromDate && toDate) {
        const daysDiff = (toDate.getTime() - fromDate.getTime()) / (1000 * 60 * 60 * 24);
        if (daysDiff > 90) {
          return reply.status(400).send({ error: 'Date range cannot exceed 90 days' });
        }
      }

      let validatedAction: AllowedAuditAction | undefined;
      if (action) {
        const validation = validateAction(action);
        if (!validation.success) {
          return reply.status(400).send({
            error: 'Invalid action parameter',
            allowedActions: ALLOWED_AUDIT_ACTIONS
          });
        }
        validatedAction = validation.data;
      }

      // P0-FIX: IDOR Vulnerability - Require explicit org_id and verify admin has access
      // Previously: any admin could query any org's data by changing orgId parameter
      // Now: org_id is required and we should verify admin membership (simplified check here)
      if (!orgId) {
        return reply.status(400).send({ error: 'orgId is required' });
      }
      
      // P0-FIX: Use consistent UUID validation (isValidUUID from input-validator)
      // instead of weak regex that accepts non-UUID 36-char hex strings
      if (!isValidUUID(orgId)) {
        return reply.status(400).send({ error: 'Invalid orgId format' });
      }
      
      // P0-FIX: Org membership verification to prevent IDOR
      const hasAccess = await verifyAdminOrgAccess(orgId);
      if (!hasAccess) {
        return reply.status(403).send({ error: 'Access denied to this organization' });
      }
      
      const db = await getDb();
      let q = db('audit_events').where({ org_id: orgId });  // P0-FIX: Always filter by org_id

      if (validatedAction) {
        q = q.where({ action: validatedAction });
      }

      if (fromDate) q = q.where('created_at', '>=', fromDate);
      if (toDate) q = q.where('created_at', '<=', toDate);

      // Get total count for pagination metadata
      const countQuery = q.clone();
      const countResult = await countQuery['count']('* as count');
      if (!Array.isArray(countResult) || countResult.length === 0 || !isCountResult(countResult[0])) {
        throw new Error('Invalid count result from database');
      }
      const count = countResult[0]['count'];
      const total = typeof count === 'string' ? parseInt(count, 10) : count;

      // Get paginated events
      const events = await q
        .orderBy('created_at', 'desc')
        .limit(limit)
        .offset(offset);

      // Validate all events have correct structure
      if (!Array.isArray(events) || !events.every(isAuditEvent)) {
        throw new Error('Invalid event data from database');
      }

      return {
        data: events,
        pagination: {
          limit,
          offset,
          total,
          hasMore: offset + events.length < total
        }
      };
    } catch (error) {
      console.error('[admin/audit] Error:', error);
      const errorResponse: { error: string; message?: string } = {
        error: 'Internal server error'
      };
      if (process.env['NODE_ENV'] === 'development' && error instanceof Error) {
        errorResponse["message"] = error["message"];
      }
      return reply.status(500).send(errorResponse);
    }
  });
}
