


import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getAuthContext } from '../types';
import { requireRole } from '../../services/auth';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';

// P2-STRICT-FIX: Added .strict() per CLAUDE.md conventions — reject extra URL params.
const DomainIdParamSchema = z.object({
  id: z.string().uuid()
}).strict();

export async function domainDetailsRoutes(app: FastifyInstance, pool: Pool) {
  // GET /domains/:id - Get detailed domain information
  app.get('/domains/:id', async (req, res) => {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);

    const paramsResult = DomainIdParamSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return errors.badRequest(res, 'Invalid domain ID');
    }
    const { id } = paramsResult.data;
    // Fetch domain details
    // C03-FIX: Removed dr.buyer_token from SELECT — secret must not be exposed to viewers
    // A02-FIX: Fixed d["id"] → d.id (invalid PostgreSQL array subscript syntax)
    // P1-ARCHIVED-FIX: Added AND d.archived_at IS NULL to exclude soft-deleted domains.
    // Without this filter, a deleted domain could still be fetched by ID, exposing
    // its config and theme to users who should only see active domains.
    const { rows } = await pool.query(
    `SELECT
    d.id, d.name, d.status, d.created_at, d.updated_at,
    dr.theme_id, dr.custom_config
    FROM domains d
    LEFT JOIN domain_registry dr ON d.id = dr.id
    WHERE d.id = $1 AND d.org_id = $2 AND d.archived_at IS NULL`,
    [id, ctx["orgId"]]
    );

    if (rows.length === 0) {
    return errors.notFound(res, 'Domain', ErrorCodes.DOMAIN_NOT_FOUND);
    }

    const domain = rows[0];

    // Fetch content stats
    // P1-IDOR-FIX: Added org_id = $2 filter. Without it, content stats could be
    // returned for any domain_id — a domain transferred to another org would still
    // expose its content counts to the previous org via this endpoint.
    const { rows: contentStats } = await pool.query(
    `SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE status = 'published') as published,
    COUNT(*) FILTER (WHERE status = 'draft') as drafts,
    COUNT(*) FILTER (WHERE status = 'archived') as archived
    FROM content_items
    WHERE domain_id = $1 AND org_id = $2`,
    [id, ctx["orgId"]]
    );

    return {
    domain: {
    id: domain.id,
    name: domain.name,
    status: domain.status,
    themeId: domain.theme_id,
    customConfig: domain.custom_config,
    createdAt: domain.created_at,
    updatedAt: domain.updated_at,
    },
    stats: {
    content: contentStats[0],
    },
    };
  });
}
