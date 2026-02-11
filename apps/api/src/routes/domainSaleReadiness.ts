import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { optionalAuthFastify, type FastifyAuthContext } from '@security/auth';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDb } from '../db';
import { computeSaleReadiness } from '../domain/saleReadiness';
import type { JwtPayload } from 'jsonwebtoken';
import { getLogger } from '../../../packages/kernel/logger';

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
const SaleReadinessQuerySchema = z.object({
  domain_id: z.string().uuid('domain_id must be a valid UUID'),
  seo: z.coerce.number().min(0).max(100).default(0),
  freshness: z.coerce.number().min(0).max(1).default(0),
  audience: z.coerce.number().min(0).max(1000000000).default(0),
  growth: z.coerce.number().min(-100).max(1000).default(0),
  revenue: z.coerce.number().min(0).max(100000000).default(0),
  risks: z.coerce.number().min(0).max(100).default(0),
});
/**
 * Validate UUID format
 */
function isValidUUID(str: string) {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
}
async function verifyAuth(req: FastifyRequest) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.slice(7);
  try {
    const jwtKey = process.env['JWT_KEY_1'];
    if (!jwtKey) {
      logger.error('JWT_KEY_1 not configured', new Error('JWT_KEY_1 not configured'));
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
export async function domainSaleReadinessRoutes(app: FastifyInstance) {
  app.get('/domain/sale-readiness', async (req, reply) => {
    const ip = (req as unknown as { ip?: string }).ip || req.socket?.remoteAddress || 'unknown';

    const auth = await verifyAuth(req);
    if (!auth) {
      return reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
    }
    try {
            const parseResult = SaleReadinessQuerySchema.safeParse(req.query);
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
        .returning('*');

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

export type SaleReadinessQueryType = z.infer<typeof SaleReadinessQuerySchema>;
