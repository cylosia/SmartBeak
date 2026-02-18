import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

import { generateBuyerRoiSummary, type RoiRow as SummaryRoiRow } from '../roi/buyerRoiSummary';
import { getDb } from '../db';
import { optionalAuthFastify } from '@security/auth';
import { getLogger } from '@kernel/logger';
import { errors } from '@errors/responses';
import { rateLimitMiddleware } from '../middleware/rateLimiter';

const logger = getLogger('BuyerRoi');

const RoleRowSchema = z.object({
  role: z.string(),
});

const RoiRowSchema = z.object({
  id: z.string(),
  content_id: z.string().optional(),
  roi_value: z.number().optional(),
  created_at: z.coerce.date().optional(),
});

export type RoiRow = z.infer<typeof RoiRowSchema>;

function validateRoleRow(row: unknown): { role: string } {
  const result = RoleRowSchema.safeParse(row);
  if (!result.success) {
  throw new Error(`Invalid role row: ${result.error["message"]}`);
  }
  return result.data;
}

function validateRoiRow(row: unknown): RoiRow {
  const result = RoiRowSchema.safeParse(row);
  if (!result.success) {
  throw new Error(`Invalid ROI row: ${result.error["message"]}`);
  }
  return result.data;
}

// P1-FIX (P1-5): Add pagination parameters. Fetching up to 10 000 rows per
// request serialises them all into memory at once, blocking the event loop
// during JSON serialisation and risking OOM on large domains.
const MAX_ROI_PAGE_SIZE = 500;
const DEFAULT_ROI_PAGE_SIZE = 100;

const BuyerRoiQuerySchema = z.object({
  domain: z.string().uuid('Domain must be a valid UUID'),
  limit: z.coerce.number().int().min(1).max(MAX_ROI_PAGE_SIZE).default(DEFAULT_ROI_PAGE_SIZE),
  cursor: z.string().uuid().optional(),
});

export type BuyerRoiQueryType = z.infer<typeof BuyerRoiQuerySchema>;

export interface RoiSummaryPagination {
  next_cursor: string | null;
  has_more: boolean;
  limit: number;
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

export interface ErrorResponse {
  error: string;
  details?: z.ZodIssue[];
  message?: string;
  code?: string;
}

export interface RoiSummaryResponse {
  domain: string;
  domain_id: string;
  roi_rows: RoiRow[];
  pagination: RoiSummaryPagination;
}

async function canAccessDomain(
  userId: string,
  domainId: string,
  orgId: string
): Promise<boolean> {
  try {
  const db = await getDb();
  const rowResult = await db('domain_registry')
    .join('memberships', 'memberships.org_id', 'domain_registry.org_id')
    .where('domain_registry.domain_id', domainId)
    .where('memberships.user_id', userId)
    .where('domain_registry.org_id', orgId)
    .select('memberships.role')
    .first();
  const row = rowResult ? validateRoleRow(rowResult) : undefined;

  return !!row;
  } catch (error) {
  logger.error('Error checking domain access', error instanceof Error ? error : new Error(String(error)));
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
  // P1-FIX: Do NOT rethrow audit failures. Audit logging is non-critical; its
  // failure must never break the user-facing request. The previous rethrow caused
  // the route handler to return 500 on any transient DB blip during audit insert,
  // and allowed DoS by filling/locking the audit_events table.
  logger.error('Failed to record audit event', error instanceof Error ? error : new Error(String(error)));
  }
}

export async function buyerRoiRoutes(app: FastifyInstance): Promise<void> {
  // P1-FIX: Apply rate limiting before auth. This endpoint runs a JOIN across
  // content_roi_models + content fetching up to 10 000 rows. Without a rate limit
  // an authenticated attacker can issue it in a tight loop, exhausting DB CPU.
  app.addHook('onRequest', rateLimitMiddleware('strict'));

  app.get<{
  Querystring: BuyerRoiQueryType;
  Reply: RoiSummaryResponse | ErrorResponse;
  }>('/roi/buyer-summary', async (
  req: FastifyRequest,
  reply: FastifyReply
  ): Promise<RoiSummaryResponse | ErrorResponse> => {
  const ip = req["ip"] || 'unknown';

  try {

    await optionalAuthFastify(req, reply);
    const auth = req.authContext;
    if (!auth) {
    return errors.unauthorized(reply, 'Unauthorized. Bearer token required.');
    }

    const parseResult = BuyerRoiQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
    return errors.validationFailed(reply, parseResult.error.issues);
    }

    const { domain, limit, cursor } = parseResult.data;

    const hasAccess = await canAccessDomain(auth.userId, domain, auth.orgId);
    if (!hasAccess) {
    logger.warn('Unauthorized access attempt', { userId: auth.userId, domainId: domain, action: 'access_roi_summary' });
    return errors.forbidden(reply, 'Access denied to domain');
    }

    const db = await getDb();
    // P1-FIX (P1-5): Use cursor-based pagination instead of LIMIT 10_000.
    // Fetch limit+1 rows to determine whether a next page exists, then trim.
    const query = db('content_roi_models')
      .join('content', 'content.id', 'content_roi_models.content_id')
      .where('content.domain_id', domain)
      .orderBy('content_roi_models.id', 'asc')
      .limit(limit + 1)
      .select(
        'content_roi_models.id',
        'content_roi_models.content_id',
        'content_roi_models.roi_value',
        'content_roi_models.created_at',
      );

    if (cursor) {
      void query.where('content_roi_models.id', '>', cursor);
    }

    const rawRows = await query;
    const hasMore = rawRows.length > limit;
    const pageRows = hasMore ? rawRows.slice(0, limit) : rawRows;
    const nextCursor = hasMore ? (pageRows[pageRows.length - 1]?.id ?? null) : null;
    const validatedRows = pageRows.map(validateRoiRow);

    await recordAuditEvent({
    orgId: auth.orgId,
    userId: auth.userId,
    action: 'buyer_roi_summary_accessed',
    entityType: 'domain',
    entityId: domain,
    metadata: {
    domain_id: domain,
    result_count: rows.length,
    },
    ip,
    });

    const summary = await generateBuyerRoiSummary({
      domain: domain,
      domain_id: domain,
      roi_rows: validatedRows as SummaryRoiRow[],
    });
    return reply.status(200).send({
      ...summary,
      pagination: {
        next_cursor: nextCursor,
        has_more: hasMore,
        limit,
      },
    });
  } catch (error) {
    logger.error('Error generating buyer ROI summary', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(reply);
  }
  });
}
