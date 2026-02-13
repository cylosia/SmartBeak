import { z } from 'zod';
// H06-FIX: Use the existing auth middleware instead of custom JWT verification
import { optionalAuthFastify } from '@security/auth';
import { FastifyInstance } from 'fastify';
import { getDb } from '../db';
import { computeSaleReadiness } from '../domain/saleReadiness';
import { getLogger } from '@kernel/logger';

const logger = getLogger('DomainSaleReadiness');

const ALLOWED_READINESS_FIELDS = [
  'domain_id',
  'score',
  'seo_score',
  'content_score',
  'audience_score',
  'revenue_score',
  'risk_score',
  'rationale'
];
const _SaleReadinessQuerySchema = z.object({
  domain_id: z.string().uuid('domain_id must be a valid UUID'),
  seo: z.coerce.number().min(0).max(100).default(0),
  freshness: z.coerce.number().min(0).max(1).default(0),
  audience: z.coerce.number().min(0).max(1000000000).default(0),
  growth: z.coerce.number().min(-100).max(1000).default(0),
  revenue: z.coerce.number().min(0).max(100000000).default(0),
  risks: z.coerce.number().min(0).max(100).default(0),
});
// H06-FIX: Removed custom verifyAuth — using @security/auth middleware instead

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
    logger.error('Error checking domain access', error instanceof Error ? error : new Error(String(error)));
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
    logger.error('Failed to record audit event', error instanceof Error ? error : new Error(String(error)));
  }
}
const SaleReadinessBodySchema = z.object({
  domain_id: z.string().uuid('domain_id must be a valid UUID'),
  seo: z.coerce.number().min(0).max(100).default(0),
  freshness: z.coerce.number().min(0).max(1).default(0),
  audience: z.coerce.number().min(0).max(1000000000).default(0),
  growth: z.coerce.number().min(-100).max(1000).default(0),
  revenue: z.coerce.number().min(0).max(100000000).default(0),
  risks: z.coerce.number().min(0).max(100).default(0),
});

export async function domainSaleReadinessRoutes(app: FastifyInstance) {
  // C05-FIX: Changed from GET to POST — this endpoint performs an INSERT, which is
  // not idempotent. GET requests bypass CSRF, can be triggered by prefetch/crawlers.
  app.post('/domain/sale-readiness', { preHandler: (...args: Parameters<typeof optionalAuthFastify>) => { void optionalAuthFastify(...args); } }, async (req, reply) => {
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';

    // H06-FIX: Use auth context from middleware instead of custom JWT verification
    const auth = req.user as { userId: string; orgId: string } | undefined;
    if (!auth) {
      return reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
    }
    try {
      const parseResult = SaleReadinessBodySchema.safeParse(req.body);
      if (!parseResult.success) {
        return reply.status(400).send({
          error: 'Invalid query parameters',
          code: 'VALIDATION_ERROR',
          details: parseResult.error.issues
        });
      }
      const { domain_id, seo: seo_completeness, freshness: content_freshness_ratio, audience: audience_size, growth: audience_growth_rate, revenue: revenue_monthly, risks: compliance_flags } = parseResult.data;

      const hasAccess = await canAccessDomain(auth.userId, domain_id, auth.orgId);
      if (!hasAccess) {
        logger.warn('Unauthorized access attempt', { userId: auth.userId, domainId: domain_id, action: 'access_sale_readiness' });
        return reply.status(403).send({ error: 'Access denied to domain' });
      }
      const result = computeSaleReadiness({
        seo_completeness,
        content_freshness_ratio,
        audience_size,
        audience_growth_rate,
        revenue_monthly,
        compliance_flags
      });
      const db = await getDb();
      const [row] = await db('domain_sale_readiness')
        .insert({
        domain_id,
        score: result.score,
        seo_score: result.breakdown.seo,
        content_score: result.breakdown.content,
        audience_score: result.breakdown.audience,
        revenue_score: result.breakdown.revenue,
        risk_score: result.breakdown.risk,
        rationale: result.rationale
      })
        .returning(ALLOWED_READINESS_FIELDS);

      await recordAuditEvent({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'sale_readiness_computed',
        entityType: 'domain',
        entityId: domain_id,
        metadata: {
          domain_id,
          score: result.score,
        },
        ip,
      });
      return row;
    }
    catch (error) {
      logger.error('Error computing domain sale readiness', error instanceof Error ? error : new Error(String(error)));
      return reply.status(500).send({
        error: 'Internal server error',
        ...(process.env['NODE_ENV'] === 'development' && { message: (error as Error)["message"] })
      });
    }
  });
}


export interface SaleReadinessRouteParams {
  Querystring: SaleReadinessQueryType;
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

// P2-21 FIX: Removed SaleReadinessQueryType (referenced deleted SaleReadinessQuerySchema)
