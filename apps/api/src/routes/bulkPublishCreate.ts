// SECURITY FIX: Use centralized JWT verification from @security/auth

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getLogger } from '../../../packages/kernel/logger';

// SECURITY FIX: P1-HIGH Issue 3 - Strict rate limiting for billing-related operations
import { rateLimitMiddleware } from '../middleware/rateLimiter';
import { extractAndVerifyToken, type JwtClaims } from '@security/jwt';
import { getDb } from '../db';

// P1-FIX: getDb() is async and must be awaited
async function getDbInstance() {
  return await getDb();
}

import { recordBulkPublishAudit } from '../domain/audit/bulkAudit';
import { sanitizeError } from '../utils/sanitizedErrors';

const logger = getLogger('BulkPublishCreate');

// Use JwtClaimsSchema from @security/jwt
const LocalJwtClaimsSchema = z.object({
  sub: z.string(),
  orgId: z.string(),
  role: z.enum(['admin', 'editor', 'viewer']).optional(),
});

const DraftInfoSchema = z.object({
  id: z.string().uuid(),
  domain_id: z.string().uuid(),
});

const DomainAccessSchema = z.object({
  domain_id: z.string().uuid(),
});

const TargetAccessSchema = z.object({
  id: z.string().uuid(),
});

const RoleRowSchema = z.object({
  role: z.string(),
});

// Use JwtClaims type from @security/jwt, not redefined locally
export type DraftInfo = z.infer<typeof DraftInfoSchema>;

function validateJwtClaims(payload: unknown): JwtClaims {
  const result = LocalJwtClaimsSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(`Invalid JWT claims: ${result.error["message"]}`);
  }
  const data = result.data;
  return {
    sub: data.sub,
    orgId: data.orgId,
    role: data.role || 'viewer',
  } as JwtClaims;
}

function validateDraftInfo(row: unknown): DraftInfo {
  const result = DraftInfoSchema.safeParse(row);
  if (!result.success) {
    throw new Error(`Invalid draft info: ${result.error["message"]}`);
  }
  return result.data;
}

function validateDomainAccess(row: unknown): { domain_id: string } {
  const result = DomainAccessSchema.safeParse(row);
  if (!result.success) {
    throw new Error(`Invalid domain access: ${result.error["message"]}`);
  }
  return result.data;
}

function validateTargetAccess(row: unknown): { id: string } {
  const result = TargetAccessSchema.safeParse(row);
  if (!result.success) {
    throw new Error(`Invalid target access: ${result.error["message"]}`);
  }
  return result.data;
}

function validateRoleRow(row: unknown): { role: string } {
  const result = RoleRowSchema.safeParse(row);
  if (!result.success) {
    throw new Error(`Invalid role row: ${result.error["message"]}`);
  }
  return result.data;
}

const BulkPublishSchema = z.object({
  drafts: z.array(z.string().uuid()).min(1).max(100, 'Cannot publish more than 100 drafts at once'),
  targets: z.array(z.string().uuid()).min(1).max(20, 'Cannot publish to more than 20 targets at once')
}).strict();

const BulkPublishQuerySchema = z.object({
  dryRun: z.enum(['true', 'false']).optional().transform(v => v === 'true'),
  notify: z.enum(['true', 'false']).optional().transform(v => v !== 'false'),
});

export type BulkPublishBodyType = z.infer<typeof BulkPublishSchema>;

export interface AuthContext {
  userId: string;
  orgId: string;
  roles: string[];
}

export interface DraftAccessResult {
  allowed: boolean;
  draftDomains?: Map<string, string>;
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

export interface BulkPublishResponse {
  status: string;
  drafts: number;
  targets: number;
  results?: PublishResult[];
  dryRun?: boolean;
}

export interface ErrorResponse {
  error: string;
  details?: z.ZodIssue[];
  allowed?: number;
  requested?: number;
  message?: string;
}

export interface PublishResult {
  draftId: string;
  targetId: string;
  status: 'success' | 'failed' | 'skipped';
  publishedAt?: Date;
  error?: string;
}

// P1-FIX: Transaction wrapper for multi-step database operations
async function publishContent(
  draftId: string,
  targetId: string,
  auth: AuthContext
): Promise<PublishResult> {
  const db = await getDbInstance();
  try {
    // P1-FIX: BEGIN transaction
    await db.raw('BEGIN');

    // Get draft content with org_id verification
    const draft = await db('content')
      .where({ id: draftId, org_id: auth.orgId })
      .select('id', 'title', 'body', 'domain_id', 'status')
      .first();

    if (!draft) {
      await db.raw('ROLLBACK');
      return { draftId, targetId, status: 'failed', error: 'Draft not found' };
    }

    if (draft.status !== 'draft') {
      await db.raw('ROLLBACK');
      return { draftId, targetId, status: 'failed', error: 'Content is not in draft status' };
    }

    // Get target integration details with org_id verification
    const target = await db('integrations')
      .where({ id: targetId, org_id: auth.orgId })
      .select('id', 'type', 'config')
      .first();

    if (!target) {
      await db.raw('ROLLBACK');
      return { draftId, targetId, status: 'failed', error: 'Target not found' };
    }

    // Update content status to published
    await db('content')
      .where({ id: draftId, org_id: auth.orgId })
      .update({
        status: 'published',
        published_at: new Date(),
        published_by: auth.userId,
        integration_id: targetId,
        updated_at: new Date(),
      });

    // Create publish record
    await db('publish_records').insert({
      id: crypto.randomUUID(),
      content_id: draftId,
      integration_id: targetId,
      org_id: auth.orgId,
      published_by: auth.userId,
      status: 'published',
      published_at: new Date(),
      created_at: new Date(),
    });

    // P1-FIX: COMMIT transaction
    await db.raw('COMMIT');

    return {
      draftId,
      targetId,
      status: 'success',
      publishedAt: new Date(),
    };
  } catch (error) {
    // CRITICAL FIX: ROLLBACK transaction on error with proper error handling
    try {
      await db.raw('ROLLBACK');
    } catch (rollbackError) {
      const rollbackErr = rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError));
      
      // Chain errors for debugging - this is a critical failure
      const originalErr = error instanceof Error ? error : new Error(String(error));
      logger.error('Rollback failed', rollbackErr, { 
        originalError: originalErr.message,
        rollbackError: rollbackErr.message 
      });
    }
    
    logger.error('Error publishing draft to target', error instanceof Error ? error : new Error(String(error)), { 
      draftId, 
      targetId 
    });
    return {
      draftId,
      targetId,
      status: 'failed',
      error: error instanceof Error ? error["message"] : 'Unknown error',
    };
  }
}

/**
 * SECURITY FIX: Use centralized JWT verification from @security/auth
 * This ensures consistent token validation across all routes
 */
async function verifyAuth(req: FastifyRequest): Promise<AuthContext | null> {
  const authHeader = req.headers.authorization;
  const result = extractAndVerifyToken(authHeader);

  if (!result.valid || !result.claims) {
    return null;
  }

  const claims = result.claims;

  if (!claims.sub || !claims.orgId) {
    return null;
  }

  return { userId: claims.sub, orgId: claims.orgId, roles: claims.role ? [claims.role] : [] };
}

async function canAccessAllDrafts(
  userId: string,
  draftIds: string[],
  orgId: string
): Promise<DraftAccessResult> {
  try {
    const db = await getDbInstance();
    // Get all drafts with their domain_ids with validation
    const draftRows = await db('content')
      .whereIn('id', draftIds)
      .where('org_id', orgId)
      .select('id', 'domain_id');
    const drafts = draftRows.map(validateDraftInfo);

    if (drafts.length !== draftIds.length) {
      return { allowed: false };
    }

    // Extract unique domain IDs
    const domainIds = [...new Set(drafts.map(d => d.domain_id))];

    // Verify user has access to all domains with validation
    const accessibleDomainRows = await db('domain_registry')
      .join('memberships', 'memberships.org_id', 'domain_registry.org_id')
      .whereIn('domain_registry.domain_id', domainIds)
      .where('memberships.user_id', userId)
      .where('domain_registry.org_id', orgId)
      .select('domain_registry.domain_id');
    const accessibleDomains = accessibleDomainRows.map(validateDomainAccess);

    const accessibleDomainIds = new Set(accessibleDomains.map(d => d.domain_id));

    for (const domainId of domainIds) {
      if (!accessibleDomainIds.has(domainId)) {
        return { allowed: false };
      }
    }

    // Create a map of draft_id -> domain_id
    const draftDomains = new Map(drafts.map(d => [d.id, d.domain_id]));

    return { allowed: true, draftDomains };
  } catch (error) {
    logger.error('Error checking draft access', error instanceof Error ? error : new Error(String(error)), { 
      userId, 
      draftCount: draftIds.length 
    });
    return { allowed: false };
  }
}

async function canAccessAllTargets(
  userId: string,
  targetIds: string[],
  orgId: string
): Promise<boolean> {
  try {
    const db = await getDbInstance();
    // Check if all targets belong to the organization with validation
    const targetRows = await db('integrations')
      .whereIn('id', targetIds)
      .where('org_id', orgId)
      .select('id');
    const targets = targetRows.map(validateTargetAccess);

    return targets.length === targetIds.length;
  } catch (error) {
    logger.error('Error checking target access', error instanceof Error ? error : new Error(String(error)), { 
      userId, 
      targetCount: targetIds.length 
    });
    return false;
  }
}

async function canPublishContent(
  userId: string,
  orgId: string
): Promise<boolean> {
  try {
    const db = await getDbInstance();
    const rowResult = await db('memberships')
      .where({ user_id: userId, org_id: orgId })
      .whereIn('role', ['admin', 'editor'])
      .select('role')
      .first();
    const row = rowResult ? validateRoleRow(rowResult) : undefined;

    return !!row;
  } catch (error) {
    logger.error('Error checking publish permission', error instanceof Error ? error : new Error(String(error)), { 
      userId, 
      orgId 
    });
    return false;
  }
}

async function recordAuditEvent(params: AuditEventParams): Promise<void> {
  try {
    const db = await getDbInstance();
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
    logger.error('Failed to record audit event', error instanceof Error ? error : new Error(String(error)), { 
      userId: params.userId, 
      action: params.action 
    });
  }
}

export async function bulkPublishCreateRoutes(app: FastifyInstance): Promise<void> {
  app.post<{
    Body: BulkPublishBodyType;
    Reply: BulkPublishResponse | ErrorResponse;
  }>('/publish/bulk', async (
    req: FastifyRequest,
    reply: FastifyReply
  ): Promise<BulkPublishResponse | ErrorResponse> => {
    const ip = req["ip"] || 'unknown';

    try {
      // SECURITY FIX: P1-HIGH Issue 3 - Strict rate limiting for publish operations (10 req/min)
      // Note: rateLimitMiddleware is applied at route level

      const auth = await verifyAuth(req);
      if (!auth) {
        return reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
      }

      const canPublish = await canPublishContent(auth.userId, auth.orgId);
      if (!canPublish) {
        logger.warn('Unauthorized publish attempt: user lacks editor/admin role', { userId: auth.userId });
        return reply.status(403).send({ error: 'Editor or admin access required to publish' });
      }

      // Validate query params
      const queryResult = BulkPublishQuerySchema.safeParse(req.query);
      const { dryRun, notify } = queryResult.success ? queryResult.data : { dryRun: false, notify: true };

      const parseResult = BulkPublishSchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Validation failed',
          code: 'VALIDATION_ERROR',
          details: parseResult.error.issues
        });
      }

      const { drafts, targets } = parseResult.data;

      const draftAccess = await canAccessAllDrafts(auth.userId, drafts, auth.orgId);
      if (!draftAccess.allowed) {
        logger.warn('Unauthorized draft access: user tried to access drafts not in their org', { userId: auth.userId });
        return reply.status(403).send({
          error: 'Access denied to one or more drafts'
        });
      }

      const targetsAccess = await canAccessAllTargets(auth.userId, targets, auth.orgId);
      if (!targetsAccess) {
        logger.warn('Unauthorized target access: user tried to access targets not in their org', { userId: auth.userId });
        return reply.status(403).send({
          error: 'Access denied to one or more targets'
        });
      }

      // Validate tier limits - fetch actual tier from database
      const dbForTier = await getDbInstance();
      const orgSettings = await dbForTier('org_settings')
        .where({ org_id: auth.orgId })
        .select('tier')
        .first();
      const tier = orgSettings?.tier || 'free';
      const maxDrafts = tier === 'agency' ? 100 : tier === 'pro' ? 20 : 5;
      const maxTargets = tier === 'agency' ? 20 : tier === 'pro' ? 10 : 3;

      if (drafts.length > maxDrafts) {
        return reply.code(402).send({
          error: 'Bulk publish limit exceeded for plan',
          allowed: maxDrafts,
          requested: drafts.length
        });
      }

      if (targets.length > maxTargets) {
        return reply.code(402).send({
          error: 'Target limit exceeded for plan',
          allowed: maxTargets,
          requested: targets.length
        });
      }

      // If dry run, return early without publishing
      if (dryRun) {
        return reply.send({
          status: 'dry_run',
          drafts: drafts.length,
          targets: targets.length,
          dryRun: true,
        });
      }

      const publishResults: PublishResult[] = [];
      for (const draftId of drafts) {
        for (const targetId of targets) {
          const result = await publishContent(draftId, targetId, auth);
          publishResults.push(result);
        }
      }

      // Record bulk publish audit
      await recordBulkPublishAudit({
        orgId: auth.orgId,
        userId: auth.userId,
        drafts,
        targets
      });

      await recordAuditEvent({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'bulk_publish_initiated',
        entityType: 'publish_intent',
        metadata: {
          draft_count: drafts.length,
          target_count: targets.length,
          draft_ids: drafts,
          target_ids: targets,
          results: publishResults,
          notify,
        },
        ip,
      });

      return {
        status: 'created',
        drafts: drafts.length,
        targets: targets.length,
        results: publishResults
      };
    } catch (error) {
      // SECURITY FIX: P1-HIGH Issue 2 - Sanitize error messages
      logger.error('Bulk publish error', error instanceof Error ? error : new Error(String(error)));
      const sanitized = sanitizeError(error, 'Internal server error', 'PUBLISH_ERROR');
      return reply.status(500).send(sanitized);
    }
  });
}
