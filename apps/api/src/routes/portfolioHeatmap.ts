

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

import { AuthContext } from '../types/fastify';
import { buildHeatmap } from '../portfolio/heatmap';
import { getDb } from '../db';
import { rateLimit } from '../utils/rateLimit';
import { getLogger } from '../../../../packages/kernel/logger';

const logger = getLogger('PortfolioHeatmapService');

function requireRole(auth: AuthContext, allowedRoles: string[]): void {
  const hasRole = auth.roles.some(role => allowedRoles.includes(role));
  if (!hasRole) {
  throw new Error('permission denied: insufficient role');
  }
}

const HeatmapQuerySchema = z.object({
  domain_id: z.string().uuid(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
});

export type HeatmapQueryType = z.infer<typeof HeatmapQuerySchema>;

export interface HeatmapRow {
  content_id: string;
  traffic: number | null;
  roi_12mo: number | null;
  freshness_days: number | null;
}

export interface HeatmapRouteParams {
  Querystring: HeatmapQueryType;
}

/**
* Portfolio heatmap routes
* MEDIUM FIX: Add proper types, validation, pagination, and error handling
*/
export async function portfolioHeatmapRoutes(app: FastifyInstance): Promise<void> {
  app.get<HeatmapRouteParams>('/portfolio/heatmap', async (
  req: FastifyRequest<HeatmapRouteParams>,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const auth = req.auth;
    if (!auth) {
        return res.status(401).send({
        error: 'Unauthorized',
        code: 'UNAUTHORIZED'
        });
    }

    requireRole(auth, ['owner', 'admin', 'editor', 'viewer']);

    // RATE LIMITING: Read endpoint - 50 requests/minute
    await rateLimit('portfolio:heatmap', 50, req, res);

    const parseResult = HeatmapQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: parseResult.error.issues
    });
    }

    const { domain_id, limit, offset } = parseResult.data;

    const db = await getDb();
    let rows: HeatmapRow[];
    try {
    rows = await db('content')
    .leftJoin('content_roi_models', 'content.id', 'content_roi_models.content_id')
    .leftJoin('page_seo_profiles', 'content.id', 'page_seo_profiles.page_id')
    .where('content.domain_id', domain_id)
    .where('content.org_id', auth.orgId) // Ensure ownership
    .select(
    'content.id as content_id',
    'content.traffic as traffic',
    'content_roi_models.roi_12mo as roi_12mo',
    db.raw('extract(day from now() - page_seo_profiles.last_reviewed_at) as freshness_days')
    )
    .limit(limit)           .offset(offset);
    } catch (dbError) {
        logger.error('Database error', dbError as Error);
    return res.status(503).send({
    error: 'Database temporarily unavailable',
    code: 'DB_UNAVAILABLE',
    message: 'Unable to fetch heatmap data. Please try again later.'
    });
    }

    const heatmapData = rows.map((r) => ({
    content_id: r.content_id,
    traffic: r.traffic || 0,
    roi_12mo: r.roi_12mo || 0,
    freshness_days: Number(r.freshness_days) || 0
    }));

    const heatmap = buildHeatmap(heatmapData);
    void res.send({
    data: heatmap,
    pagination: {
    hasMore: rows.length === limit
    }
    });
  } catch (error) {
    logger.error('Unexpected error', error as Error);

    // P1-FIX: Use error codes instead of message sniffing
    const errWithCode = error as Error & { code?: string };
    const hasPermissionError = error instanceof Error &&
    (errWithCode.code === 'PERMISSION_DENIED' ||
    errWithCode.code === 'FORBIDDEN');
    if (hasPermissionError) {
    return res.status(403).send({
        error: 'Permission denied',
        code: 'FORBIDDEN'
    });
    }

    return res.status(500).send({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error["message"] : 'Unknown error'
    });
  }
  });
}
