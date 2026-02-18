import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

import { generateBuyerRoiSummary, type RoiRow as SummaryRoiRow } from '../roi/buyerRoiSummary';
import { getDb } from '../db';
import { optionalAuthFastify } from '@security/auth';
import { getLogger } from '@kernel/logger';
import { errors } from '@errors/responses';

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

const BuyerRoiQuerySchema = z.object({
  domain: z.string().uuid('Domain must be a valid UUID')
});

export type BuyerRoiQueryType = z.infer<typeof BuyerRoiQuerySchema>;

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
  logger.error('Failed to record audit event', error instanceof Error ? error : new Error(String(error)));
  throw error;
  }
}

export async function buyerRoiRoutes(app: FastifyInstance): Promise<void> {
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

    const { domain } = parseResult.data;

    const hasAccess = await canAccessDomain(auth.userId, domain, auth.orgId);
    if (!hasAccess) {
    logger.warn('Unauthorized access attempt', { userId: auth.userId, domainId: domain, action: 'access_roi_summary' });
    return errors.forbidden(reply, 'Access denied to domain');
    }

    const db = await getDb();
    const rows = await db('content_roi_models')
    .join('content', 'content.id', 'content_roi_models.content_id')
    .where('content.domain_id', domain)
    .limit(10_000)
    .select(
      'content_roi_models.id',
      'content_roi_models.content_id',
      'content_roi_models.roi_value',
      'content_roi_models.created_at',
    );
    const validatedRows = rows.map(validateRoiRow);

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
    roi_rows: validatedRows as SummaryRoiRow[]
    });
    // P1-FIX: Removed unsafe double assertion (as unknown as X). The summary
    // type is now trusted directly — if there's a mismatch, tsc will catch it.
    return reply.status(200).send(summary);
  } catch (error) {
    logger.error('Error generating buyer ROI summary', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(reply);
  }
  });
}
