

import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getAuthContext } from '../types';
import { requireRole } from '../../services/auth';
import { getLogger } from '@kernel/logger';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';

const logger = getLogger('domain-details');

const DomainIdParamSchema = z.object({
  id: z.string().uuid()
});

export async function domainDetailsRoutes(app: FastifyInstance, pool: Pool) {
  // GET /domains/:id - Get detailed domain information
  app.get('/domains/:id', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);

  const { id } = DomainIdParamSchema.parse(req.params);

  try {
    // Fetch domain details
    // C03-FIX: Removed dr.buyer_token from SELECT — secret must not be exposed to viewers
    // A02-FIX: Fixed d["id"] → d.id (invalid PostgreSQL array subscript syntax)
    const { rows } = await pool.query(
    `SELECT
    d.id, d.name, d.status, d.created_at, d.updated_at,
    dr.theme_id, dr.custom_config
    FROM domains d
    LEFT JOIN domain_registry dr ON d.id = dr.id
    WHERE d.id = $1 AND d.org_id = $2`,
    [id, ctx["orgId"]]
    );

    if (rows.length === 0) {
    return errors.notFound(res, 'Domain', ErrorCodes.DOMAIN_NOT_FOUND);
    }

    const domain = rows[0];

    // Fetch content stats
    const { rows: contentStats } = await pool.query(
    `SELECT
    COUNT(*) as total,
    COUNT(*) FILTER (WHERE status = 'published') as published,
    COUNT(*) FILTER (WHERE status = 'draft') as drafts,
    COUNT(*) FILTER (WHERE status = 'archived') as archived
    FROM content_items
    WHERE domain_id = $1`,
    [id]
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
  } catch (error) {
    logger.error('Failed to fetch domain details', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res, 'Failed to fetch domain details');
  }
  });
}
