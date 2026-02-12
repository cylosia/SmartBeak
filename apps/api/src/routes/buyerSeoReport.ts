import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

import { generateBuyerSeoReport, BuyerSeoReport } from '../seo/buyerReport';
import { getDb } from '../db';
import { optionalAuthFastify, type FastifyAuthContext } from '@security/auth';
import { getLogger } from '@kernel/logger';

const logger = getLogger('BuyerSeoReport');

const RoleRowSchema = z.object({
  role: z.string(),
});

const DomainRecordSchema = z.object({
  domain_id: z.string().uuid(),
});

function validateRoleRow(row: unknown): { role: string } {
  const result = RoleRowSchema.safeParse(row);
  if (!result.success) {
  throw new Error(`Invalid role row: ${result.error["message"]}`);
  }
  return result.data;
}

function validateDomainRecord(row: unknown): { domain_id: string } {
  const result = DomainRecordSchema.safeParse(row);
  if (!result.success) {
  throw new Error(`Invalid domain record: ${result.error["message"]}`);
  }
  return result.data;
}

const SeoReportQuerySchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  pages: z.coerce.number().min(0).optional(),
  clusters: z.coerce.number().min(0).optional(),
  freshness_ratio: z.coerce.number().min(0).max(1).optional(),
  schema_coverage: z.coerce.number().min(0).max(1).optional()
});

export type SeoReportQueryType = z.infer<typeof SeoReportQuerySchema>;

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

// Cache buyer reports for 1 hour since SEO data doesn't change frequently
const CACHE_MAX_AGE = 3600; // 1 hour in seconds

// P1-FIX: getDb() is async and must be awaited
async function getDbInstance(): Promise<ReturnType<typeof getDb>> {
  const { getDb } = await import('../db');
  return getDb();
}

async function canAccessDomain(
  userId: string,
  domainId: string,
  orgId: string
): Promise<boolean> {
  try {
  const db = await getDbInstance();
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
  logger.error('Failed to record audit event', error instanceof Error ? error : new Error(String(error)));
  }
}

export async function buyerSeoReportRoutes(app: FastifyInstance): Promise<void> {
  app.get<{
  Querystring: SeoReportQueryType;
  Reply: BuyerSeoReport | ErrorResponse;
  }>('/seo/buyer-report', async (
  req: FastifyRequest<{ Querystring: SeoReportQueryType }>,
  reply: FastifyReply
  ): Promise<BuyerSeoReport | ErrorResponse> => {
  const ip = req["ip"] || 'unknown';

  await optionalAuthFastify(req, reply, () => {});
  const auth = req.authContext;
  if (!auth) {
    return reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
  }

  // P1-FIX: Cache Poisoning - Use private cache control for sensitive SEO reports
  reply.header('Cache-Control', `private, max-age=${CACHE_MAX_AGE}`);
  reply.header('Expires', new Date(Date.now() + CACHE_MAX_AGE * 1000).toUTCString());

  try {
    // Validate query parameters
    const parseResult = SeoReportQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
    return reply.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: parseResult.error.issues
    });
    }

    const { domain, pages, clusters, freshness_ratio, schema_coverage } = parseResult.data;

    // Note: The domain parameter here is a domain name (string), not a UUID
    // We need to look up the domain in domain_registry first
  const dbForQuery = await getDbInstance();
    const domainRecordResult = await dbForQuery('domain_registry')
    .where('domain', domain)
    .select('domain_id')
    .first();
    const domainRecord = domainRecordResult ? validateDomainRecord(domainRecordResult) : undefined;

    if (!domainRecord) {
    return reply.status(404).send({ error: 'Domain not found' });
    }

    const hasAccess = await canAccessDomain(auth.userId, domainRecord.domain_id, auth.orgId);
    if (!hasAccess) {
    logger.warn('Unauthorized access attempt', { userId: auth.userId, domain, action: 'access_seo_report' });
    return reply.status(403).send({ error: 'Access denied to domain' });
    }

    const report = generateBuyerSeoReport({
    domain,
    pages: pages ?? 0,
    clusters: clusters ?? 0,
    freshness_ratio: freshness_ratio ?? 0,
    schema_coverage: schema_coverage ?? 0
    });

    await recordAuditEvent({
    orgId: auth.orgId,
    userId: auth.userId,
    action: 'buyer_seo_report_accessed',
    entityType: 'domain',
    entityId: domainRecord.domain_id,
    metadata: {
    domain_id: domainRecord.domain_id,
    },
    ip: req.ip || 'unknown',
    });

    return report;
  } catch (error) {
    logger.error('Error generating buyer SEO report', error instanceof Error ? error : new Error(String(error)));
    const errorResponse: ErrorResponse = {
    error: 'Internal server error'
    };
    if (process.env.NODE_ENV === 'development' && error instanceof Error) {
    errorResponse["message"] = error["message"];
    }
    return reply.status(500).send(errorResponse);
  }
  });
}
