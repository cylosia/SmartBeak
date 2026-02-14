import { z } from 'zod';
import jwt from 'jsonwebtoken';
import { getDb } from '../db';
import { csrfProtection } from '../middleware/csrf';
import { FastifyInstance } from 'fastify';
import { computeContentRoi } from '../roi/contentRoi';
import { getLogger } from '@kernel/logger';
import { errors } from '@errors/responses';

const logger = getLogger('ContentRoi');

// Using 'as const' for type safety
const ALLOWED_ROI_FIELDS = [
  'domain_id',
  'content_id',
  'production_cost_usd',
  'monthly_traffic_estimate',
  'conversion_rate',
  'revenue_per_conversion',
  'monthly_revenue_estimate',
  'payback_months',
  'roi_12mo',
  'assumptions'
] as const;

const ContentRoiSchema = z.object({
  domain_id: z.string().uuid('domain_id must be a valid UUID'),
  content_id: z.string().uuid('content_id must be a valid UUID'),
  production_cost_usd: z.number().min(0).max(1000000),
  monthly_traffic: z.number().min(0).max(1000000000),
  conversion_rate: z.number().min(0).max(100),
  revenue_per_conversion: z.number().min(0).max(1000000),
});
/**
 * Whitelist fields to prevent mass assignment vulnerabilities
 * @param input - Input object
 * @param allowed - Allowed field names
 * @returns Filtered object with only allowed fields
 */
function whitelistFields<T extends Record<string, unknown>>(
  input: T,
  allowed: readonly string[]
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const key of allowed) {
    if (key in input) {
      result[key] = input[key];
    }
  }
  return result;
}
interface AuthClaims {
  sub?: string;
  orgId?: string;
}

type AuthResult = {
  userId: string;
  orgId: string;
} | null;

async function verifyAuth(req: { headers: { authorization?: string } }): Promise<AuthResult> {
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
    }) as AuthClaims;
    if (!claims.sub || !claims.orgId) {
      return null;
    }
    return { userId: claims.sub, orgId: claims.orgId };
  }
  catch (err) {
    return null;
  }
}

async function canAccessDomain(userId: string, domainId: string, orgId: string): Promise<boolean> {
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

async function canModifyContent(userId: string, domainId: string, orgId: string): Promise<boolean> {
  try {
    const db = await getDb();
    const row = await db('domain_registry')
      .join('memberships', 'memberships.org_id', 'domain_registry.org_id')
      .where('domain_registry.domain_id', domainId)
      .where('memberships.user_id', userId)
      .where('domain_registry.org_id', orgId)
      .whereIn('memberships.role', ['admin', 'editor'])
      .select('memberships.role')
      .first();
    return !!row;
  }
  catch (error) {
    logger.error('Error checking content modification access', error instanceof Error ? error : new Error(String(error)));
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
      ip_address: params.ip,
      created_at: new Date(),
    });
  }
  catch (error) {
    logger.error('Failed to record audit event', error instanceof Error ? error : new Error(String(error)));
  }
}

export async function contentRoiRoutes(app: FastifyInstance): Promise<void> {
  // P1-8 FIX: Apply CSRF protection (was imported but never used)
  app.addHook('onRequest', csrfProtection());

  app.post('/content/roi', async (req, reply) => {
    const ip = (req as unknown as { ip?: string }).ip || (req.socket?.remoteAddress) || 'unknown';
    try {

      const auth = await verifyAuth(req as unknown as { headers: { authorization?: string } });
      if (!auth) {
        return errors.unauthorized(reply, 'Unauthorized. Bearer token required.');
      }

      const body = (req.body || {}) as Record<string, unknown>;
      // Validate input with Zod schema
      const parseResult = ContentRoiSchema.safeParse({
        domain_id: body['domain_id'],
        content_id: body['content_id'],
        production_cost_usd: body['production_cost_usd'],
        monthly_traffic: body['monthly_traffic'],
        conversion_rate: body['conversion_rate'],
        revenue_per_conversion: body['revenue_per_conversion'],
      });
      if (!parseResult.success) {
        return errors.validationFailed(reply, parseResult.error.issues);
      }
      const { domain_id, content_id, production_cost_usd, monthly_traffic, conversion_rate, revenue_per_conversion } = parseResult.data;

      const hasAccess = await canAccessDomain(auth.userId, domain_id, auth.orgId);
      if (!hasAccess) {
        logger.warn('Unauthorized access attempt', { userId: auth.userId, domainId: domain_id, action: 'access_roi' });
        return errors.forbidden(reply, 'Access denied to domain');
      }

      const canModify = await canModifyContent(auth.userId, domain_id, auth.orgId);
      if (!canModify) {
        logger.warn('Unauthorized modification attempt', { userId: auth.userId, domainId: domain_id, action: 'create_roi' });
        return errors.forbidden(reply, 'Editor or admin access required');
      }

      const db = await getDb();
      // P0-7 FIX: Wrong table name — schema uses 'content_items', not 'content'
      const contentExists = await db('content_items')
        .where({ id: content_id, domain_id })
        .first();
      if (!contentExists) {
        return errors.notFound(reply, 'Content');
      }
      const roi = computeContentRoi({
        production_cost_usd,
        monthly_traffic,
        conversion_rate,
        revenue_per_conversion
      });

      const roiData: Record<string, unknown> = {
        domain_id,
        content_id,
        production_cost_usd,
        monthly_traffic_estimate: monthly_traffic,
        conversion_rate,
        revenue_per_conversion,
        monthly_revenue_estimate: roi.monthly_revenue,
        payback_months: roi.payback_months,
        roi_12mo: roi.roi_12mo,
        assumptions: {
          conversion_rate,
          revenue_per_conversion
        }
      };
      // Whitelist fields before insertion to prevent mass assignment
      const sanitizedData = whitelistFields(roiData, ALLOWED_ROI_FIELDS);
      const result = await db('content_roi_models')
        .insert(sanitizedData)
        .returning('*');
      if (!Array.isArray(result) || result.length === 0) {
        throw new Error('Failed to create ROI model');
      }
      const row = result[0];

      await recordAuditEvent({
        orgId: auth.orgId,
        userId: auth.userId,
        action: 'content_roi_created',
        entityType: 'content_roi_model',
        entityId: row.id as string,
        metadata: {
          domain_id,
          content_id,
          production_cost_usd,
          monthly_traffic,
          roi_12mo: roi.roi_12mo,
        },
        ip,
      });
      return { roi: row };
    }
    catch (error) {
      logger.error('Error processing content ROI', error instanceof Error ? error : new Error(String(error)));
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

export type ContentRoiModel = {
  id: string;
  contentId: string;
  roiValue: number;
  createdAt: Date;
};
