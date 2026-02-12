

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

import { AuthContext } from '../types/fastify';
import { dbConfig, paginationConfig } from '@config';
import { getDb } from '../db';
import { rateLimit } from '../utils/rateLimit';
import { recommendNextActions } from '../advisor/nextActions';
import { getLogger } from '../../../../packages/kernel/logger';

const QUERY_TIMEOUT_MS = dbConfig.queryTimeoutMs;

const logger = getLogger('NextActionsAdvisorService');

function requireRole(auth: AuthContext, allowedRoles: string[]): void {
  const hasRole = auth.roles.some(role => allowedRoles.includes(role));
  if (!hasRole) {
  throw new Error('permission denied: insufficient role');
  }
}

const QuerySchema = z.object({
  domain_id: z.string().uuid(),
  limit: z.coerce.number().min(1).max(paginationConfig.maxLimit).default(paginationConfig.adminDefaultLimit),
  offset: z.coerce.number().min(0).default(0),
});

export type QueryType = z.infer<typeof QuerySchema>;

export interface ContentRow {
  content_id: string;
  traffic: number | null;
  roi_12mo: number | null;
  freshness_days: number | null;
  impressions_30d: number | null;
  impressions_prev_30d: number | null;
  serp_volatility: string | null;
}

export interface ContentSignal {
  content_id: string;
  traffic: number;
  roi_12mo: number;
  freshness_days: number;
  decay: boolean;
  serp_volatility: string;
}

export interface NextActionsRouteParams {
  Querystring: QueryType;
}

/**
* Next actions advisor routes
* MEDIUM FIX: Add proper types, pagination, and error handling
*/
export async function nextActionsAdvisorRoutes(app: FastifyInstance): Promise<void> {
  app.get<NextActionsRouteParams>('/advisor/next-actions', async (
  req: FastifyRequest<NextActionsRouteParams>,
  res: FastifyReply
  ): Promise<void> => {
  try {
    const parseResult = QuerySchema.safeParse(req.query);
    if (!parseResult.success) {
    res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: parseResult.error.issues,
    });
    return;
    }

    const { domain_id, limit, offset } = parseResult.data;

    const auth = req.auth;
    if (!auth) {
    res.status(401).send({
    error: 'Unauthorized',
    code: 'UNAUTHORIZED'
    });
    return;
    }
    requireRole(auth, ['owner', 'admin', 'editor']);

    // RATE LIMITING: Read endpoint - 50 requests/minute
    await rateLimit('advisor:next-actions', 50, req, res);

    const db = await getDb();

    // P1-FIX: IDOR - Verify domain ownership before querying
    const domainOwnership = await db('domain_registry')
    .where('domain_id', domain_id)
    .where('org_id', auth.orgId)
    .first();
    if (!domainOwnership) {
    res.status(403).send({
        error: 'Access denied to domain',
        code: 'FORBIDDEN'
    });
    return;
    }

    // P1-FIX: Use SET LOCAL within a transaction so statement_timeout does not
    // persist on the pooled connection after it's returned (session-level pollution).
    let rows: ContentRow[];
    try {
    rows = await db.transaction(async (trx) => {
    await trx.raw('SET LOCAL statement_timeout = ?', [QUERY_TIMEOUT_MS]);
    return trx('content')
    .leftJoin('content_roi_models', 'content.id', 'content_roi_models.content_id')
    .leftJoin('page_seo_profiles', 'content.id', 'page_seo_profiles.page_id')
    .where('content.domain_id', domain_id)
    .where('content.org_id', auth.orgId)
    .select(
    'content.id as content_id',
    'content.traffic as traffic',
    'content_roi_models.roi_12mo as roi_12mo',
    trx.raw('extract(day from now() - page_seo_profiles.last_reviewed_at) as freshness_days'),
    'content.impressions_30d',
    'content.impressions_prev_30d',
    'content.serp_volatility'
    )
    .limit(limit)
    .offset(offset);
    });
    } catch (dbError) {
        logger.error('Database error', dbError as Error);
    res.status(503).send({
    error: 'Database temporarily unavailable',
    code: 'DB_UNAVAILABLE',
    message: 'Unable to fetch content data. Please try again later.'
    });
    return;
    }

    const signals = rows.map((r) => ({
    content_id: r.content_id,
    traffic: r.traffic || 0,
    roi_12mo: r.roi_12mo || 0,
    freshness_days: Number(r.freshness_days) || 0,

    // Using inline decay detection logic instead
    decay: (() => {
    const impressions_30d = r.impressions_30d || 0;
    const impressions_prev_30d = r.impressions_prev_30d || 0;
    if (impressions_prev_30d === 0) return false;
    const drop = (impressions_prev_30d - impressions_30d) / impressions_prev_30d;
    return drop > 0.25;
    })(),
    serp_volatility: (r.serp_volatility || 'stable') as 'stable' | 'moderate' | 'volatile'
    }));

    const recommendations = recommendNextActions(signals);
    res.send({
    data: recommendations,
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

    // P1-FIX: Removed error.message leak — internal details (SQL errors, stack traces)
    // must not be sent to clients. Full error is already logged above.
    return res.status(500).send({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    });
  }
  });
}
