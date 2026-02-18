


import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';
import { errors, sendError } from '@errors/responses';
import { ErrorCodes } from '@errors';

import { BillingService } from '../../services/billing';
import { getAuthContext } from '../types';
import { PricingUXService } from '../../services/pricing-ux';
import { requireRole } from '../../services/auth';
import { UsageService } from '../../services/usage';

const logger = getLogger('domains-routes');

// Validate domain labels separately to avoid ReDoS from nested quantifiers
function isValidDomainLabel(l: string): boolean {
  return l.length >= 1 && l.length <= 63
    && /^[a-zA-Z0-9]/.test(l) && /[a-zA-Z0-9]$/.test(l)
    && /^[a-zA-Z0-9-]+$/.test(l);
}

const DomainNameSchema = z.string()
  .min(1, 'Domain name is required')
  .max(253, 'Domain name must be 253 characters or less')
  .refine(
    (domain) => domain.split('.').every(isValidDomainLabel),
    { message: 'Invalid domain name format' }
  )
  .toLowerCase()
  .trim();

// DM-12-FIX (P3): Added .strict() to all request body/param/query schemas per CLAUDE.md
const CreateDomainBodySchema = z.object({
  name: DomainNameSchema,
  domainType: z.enum(['money', 'brand', 'test', 'redirect']).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
}).strict();

const DomainParamsSchema = z.object({
  domainId: z.string().uuid('Domain ID must be a valid UUID'),
}).strict();

const UpdateDomainBodySchema = z.object({
  name: DomainNameSchema.optional(),
  domainType: z.enum(['money', 'brand', 'test', 'redirect']).optional(),
  status: z.enum(['active', 'inactive', 'pending', 'suspended']).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
}).strict().refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

const DomainQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'pending', 'suspended', 'all']).optional().default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict();

export async function domainRoutes(app: FastifyInstance, pool: Pool) {
  const billing = new BillingService(pool);
  const usage = new UsageService(pool);
  const pricing = new PricingUXService(billing, usage);

  // GET /domains - List all domains for the organization
  app.get('/domains', async (req, res) => {
  // DM-1-FIX (P1): Auth/validation moved inside try so requireRole/getAuthContext
  // errors are caught and returned as structured responses instead of raw Fastify 500s.
  try {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);

  // Validate orgId
  if (!ctx?.['orgId']) {
    return errors.badRequest(res, 'Organization ID is required');
  }

  const orgIdResult = z.string().uuid().safeParse(ctx['orgId']);
  if (!orgIdResult.success) {
    return errors.badRequest(res, 'Invalid organization ID');
  }

  // P1-2 FIX: Return 400 on validation failure instead of silent fallback to defaults
  const queryResult = DomainQuerySchema.safeParse(req.query);
  if (!queryResult.success) {
    return errors.validationFailed(res, queryResult.error.issues);
  }
  const { status, page, limit } = queryResult.data;

  // P0-4 FIX: Cap maximum page to prevent OFFSET DoS (deep pages cause full table scans)
  const MAX_PAGE = 100;
  if (page > MAX_PAGE) {
    return errors.badRequest(res, `Page number must not exceed ${MAX_PAGE}. Use cursor-based pagination for deeper access.`);
  }

  const offset = (page - 1) * limit;

  try {
    // H11-FIX: Filter out archived (soft-deleted) domains by default
    let query = `SELECT
    d.id, d.name, d.status, d.created_at, d.updated_at,
    dr.domain_type, dr.revenue_confidence, dr.replaceability
    FROM domains d
    LEFT JOIN domain_registry dr ON d.id = dr.id
    WHERE d.org_id = $1 AND d.archived_at IS NULL
    `;
    const params: unknown[] = [ctx["orgId"]];

    if (status !== 'all') {
    query += ` AND d.status = $${params.length + 1}`;
    params.push(status);
    }

    query += ` ORDER BY d.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const { rows } = await pool.query(query, params);

    // Transform snake_case to camelCase for frontend
    const domains = rows.map(row => ({
      id: row['id'],
      name: row.name,
      status: row.status,
      domainType: row.domain_type,
      revenueConfidence: row.revenue_confidence,
      replaceability: row.replaceability,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));

    return domains;
  } catch (error) {
    logger.error('[domains] Error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res, 'Failed to fetch domains');
  }
  // Outer catch for DM-1-FIX: catches auth/validation errors above the inner try
  } catch (error) {
    logger.error('[domains] Auth/validation error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res, 'Failed to fetch domains');
  }
  });

  // GET /domains/allowance - Get domain allowance for organization
  app.get('/domains/allowance', async (req, res) => {
  // DM-1-FIX (P1) / DM-13-FIX (P2): Auth + getDomainAllowance wrapped in try/catch
  try {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin']);

    // Validate orgId
    if (!ctx?.['orgId']) {
      return errors.badRequest(res, 'Organization ID is required');
    }

    const orgIdResult = z.string().uuid().safeParse(ctx['orgId']);
    if (!orgIdResult.success) {
      return errors.badRequest(res, 'Invalid organization ID');
    }

    return await pricing.getDomainAllowance(ctx['orgId']);
  } catch (error) {
    logger.error('[domains/allowance] Error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res, 'Failed to fetch domain allowance');
  }
  });

  // POST /domains - Create a new domain
  app.post('/domains', async (req, res) => {
  // DM-1-FIX (P1): Auth/validation inside top-level try to return structured errors
  try {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin']);

    // Validate orgId
    if (!ctx?.['orgId']) {
      return errors.badRequest(res, 'Organization ID is required');
    }

    const orgIdResult = z.string().uuid().safeParse(ctx['orgId']);
    if (!orgIdResult.success) {
      return errors.badRequest(res, 'Invalid organization ID');
    }

    // Validate body
    const bodyResult = CreateDomainBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return errors.validationFailed(res, bodyResult['error'].issues);
    }

    const { name, domainType } = bodyResult.data;

    // DM-5-FIX NOTE (P1): The plan is fetched before the transaction to avoid holding
    // the org_usage FOR UPDATE lock during an external billing call (which would cause
    // starvation under burst load). The trade-off is that quota bypass is possible if
    // the plan is downgraded between the pre-fetch and the lock acquisition. For now we
    // accept this trade-off. A future fix should re-fetch the plan inside the transaction
    // using billing.getActivePlanInTx(client, orgId) to eliminate the window entirely.
    const plan = await billing.getActivePlan(ctx['orgId']);

    // DM-6-FIX (P2): Explicitly block domain creation when no active plan is found.
    // Previously a null plan silently allowed unlimited domain creation (revenue loss).
    // Free-tier orgs should have a plan configured with max_domains set appropriately.
    if (plan === null || plan === undefined) {
      return sendError(res, 402, ErrorCodes.QUOTA_EXCEEDED, 'No active subscription found. Please subscribe to create domains.', {});
    }

    // SECURITY FIX: Use transaction with SELECT FOR UPDATE to prevent race condition
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

      // Lock the org_usage row to prevent concurrent quota checks
      const { rows: usageRows } = await client.query(
        'SELECT domain_count FROM org_usage WHERE org_id = $1 FOR UPDATE',
        [ctx['orgId']]
      );

      const currentDomainCount = (usageRows[0]?.['domain_count'] as number | undefined) ?? 0;
      const maxDomains = plan?.max_domains;

      if (maxDomains !== null && maxDomains !== undefined && currentDomainCount >= maxDomains) {
        await client.query('ROLLBACK');
        return sendError(res, 402, ErrorCodes.QUOTA_EXCEEDED, 'Domain limit exceeded', {
          details: { current: currentDomainCount, limit: maxDomains },
        });
      }

      const domainId = randomUUID();

      // Insert into domains table
      await client.query(
        `INSERT INTO domains (id, org_id, name, status, created_at, updated_at)
        VALUES ($1, $2, $3, $4, NOW(), NOW())`,
        [domainId, ctx['orgId'], name, 'active']
      );

      // Insert into domain_registry if domain type provided
      if (domainType) {
        await client.query(
          'INSERT INTO domain_registry (id, org_id, domain_type) VALUES ($1, $2, $3)',
          [domainId, ctx['orgId'], domainType]
        );
      } else {
        await client.query(
          'INSERT INTO domain_registry (id, org_id) VALUES ($1, $2)',
          [domainId, ctx['orgId']]
        );
      }

      // Increment usage count
      await client.query(
        `INSERT INTO org_usage (org_id, domain_count, updated_at)
        VALUES ($1, 1, NOW())
        ON CONFLICT (org_id)
        DO UPDATE SET domain_count = org_usage.domain_count + 1, updated_at = NOW()`,
        [ctx['orgId']]
      );

      await client.query('COMMIT');
      return { id: domainId, name, status: 'active' };
    } catch (error) {
      // DM-14-FIX (P2): Wrap ROLLBACK in try/catch to prevent hanging response
      // if the connection breaks mid-transaction.
      try { await client.query('ROLLBACK'); } catch (rollbackError) {
        logger.error('Rollback failed during POST', rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
      }
      logger.error('[domains POST] Error', error instanceof Error ? error : new Error(String(error)));
      return errors.internal(res, 'Failed to create domain');
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('[domains POST] Auth/validation error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res, 'Failed to create domain');
  }
  });

  // GET /domains/:domainId - Get a specific domain
  app.get('/domains/:domainId', async (req, res) => {
  // DM-1-FIX (P1): All errors including auth wrapped in single try/catch
  try {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);

    // Validate orgId
    if (!ctx?.['orgId']) {
      return errors.badRequest(res, 'Organization ID is required');
    }

    // Validate params
    const paramsResult = DomainParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return errors.validationFailed(res, paramsResult['error'].issues);
    }

    const { domainId } = paramsResult.data;

    // DM-9-FIX / DM-11-FIX: Combine ownership check with the main query.
    // The prior pattern ran SELECT 1 outside the main try, creating a TOCTOU window
    // and leaking resource existence via 403 (403 = exists but forbidden vs 404 = unknown).
    // Both "not found" and "wrong org" now return 404 to prevent domain enumeration.
    const { rows } = await pool.query(
      `SELECT
      d.id, d.name, d.status, d.created_at, d.updated_at,
      dr.domain_type, dr.revenue_confidence, dr.replaceability
      FROM domains d
      LEFT JOIN domain_registry dr ON d.id = dr.id
      WHERE d.id = $1 AND d.org_id = $2 AND d.archived_at IS NULL`,
      [domainId, ctx['orgId']]
    );

    if (rows.length === 0) {
      return errors.notFound(res, 'Domain');
    }

    const row = rows[0];
    return {
      id: row['id'],
      name: row.name,
      status: row.status,
      domainType: row.domain_type,
      revenueConfidence: row.revenue_confidence,
      replaceability: row.replaceability,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  } catch (error) {
    logger.error('[domains/:domainId] Error', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res, 'Failed to fetch domain');
  }
  });

  // PATCH /domains/:domainId - Update a domain
  app.patch('/domains/:domainId', async (req, res) => {
  // DM-1-FIX (P1): Auth/validation inside try for structured error responses
  try {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin']);

    // Validate orgId
    if (!ctx?.['orgId']) {
      return errors.badRequest(res, 'Organization ID is required');
    }

    // Validate params
    const paramsResult = DomainParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return errors.validationFailed(res, paramsResult['error'].issues);
    }

    // Validate body
    const bodyResult = UpdateDomainBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return errors.validationFailed(res, bodyResult['error'].issues);
    }

    const { domainId } = paramsResult.data;
    const updateData = bodyResult.data;

    // H08-FIX: Wrap both updates in a transaction to prevent partial update
    // DM-9-FIX (P1): Ownership check moved inside transaction using SELECT FOR UPDATE.
    // Prior pattern ran SELECT 1 outside the transaction — creating a TOCTOU window
    // where a concurrent transferDomain could succeed between the check and the UPDATE.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL statement_timeout = $1', [30000]);

      // Lock the domain row and verify ownership atomically within the transaction
      const { rows: lockRows } = await client.query(
        'SELECT 1 FROM domains WHERE id = $1 AND org_id = $2 AND archived_at IS NULL FOR UPDATE',
        [domainId, ctx['orgId']]
      );
      if (lockRows.length === 0) {
        await client.query('ROLLBACK');
        // DM-11-FIX (P2): Return 404 (not 403) — prevents org enumeration by differentiating
        // "your domain vs someone else's domain". Both cases return "not found" to caller.
        return errors.notFound(res, 'Domain');
      }

      // Build update query dynamically
      const updates: string[] = [];
      const values: (string | number | boolean | null)[] = [];
      let paramIndex = 1;

      if (updateData.name !== undefined) {
        updates.push(`name = $${paramIndex++}`);
        values.push(updateData.name);
      }
      if (updateData.status !== undefined) {
        updates.push(`status = $${paramIndex++}`);
        values.push(updateData.status);
      }

      updates.push(`updated_at = NOW()`);
      values.push(domainId, ctx['orgId']);

      if (updates.length > 0) {
        const result = await client.query(
          `UPDATE domains SET ${updates.join(', ')} WHERE id = $${paramIndex} AND org_id = $${paramIndex + 1}`,
          values
        );
        // DM-7-FIX (P1): rowCount can be null for non-DML queries in pg; use ?? to guard
        if ((result.rowCount ?? 0) === 0) {
          await client.query('ROLLBACK');
          return errors.notFound(res, 'Domain');
        }
      }

      // DM-8-FIX (P0): Added AND org_id = $3 to domain_registry UPDATE.
      // Without this, a former owner could overwrite the new owner's domain_type after
      // a concurrent transfer: the SELECT FOR UPDATE above locked domains, but domain_registry
      // was updated with no org check, allowing cross-tenant write after ownership changed.
      if (updateData.domainType !== undefined) {
        await client.query(
          'UPDATE domain_registry SET domain_type = $1 WHERE id = $2 AND org_id = $3',
          [updateData.domainType, domainId, ctx['orgId']]
        );
      }

      await client.query('COMMIT');
      return { id: domainId, updated: true };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {
        logger.error('Rollback failed during PATCH', rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
      }
      logger.error('[domains/:domainId PATCH] Error:', error instanceof Error ? error : new Error(String(error)));
      return errors.internal(res, 'Failed to update domain');
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('[domains/:domainId PATCH] Auth/validation error:', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res, 'Failed to update domain');
  }
  });

  // DELETE /domains/:domainId - Delete a domain (soft delete)
  app.delete('/domains/:domainId', async (req, res) => {
  // DM-1-FIX (P1): Auth/validation inside try for structured error responses
  try {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner']);

    // Validate orgId
    if (!ctx?.['orgId']) {
      return errors.badRequest(res, 'Organization ID is required');
    }

    // Validate params
    const paramsResult = DomainParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return errors.validationFailed(res, paramsResult['error'].issues);
    }

    const { domainId } = paramsResult.data;

    // DM-10-FIX (P1): Ownership check + delete wrapped in transaction with FOR UPDATE.
    // Prior pattern ran SELECT 1 outside the transaction (TOCTOU). If a concurrent
    // transferDomain moved the domain between the pre-check and the DELETE, the
    // org_usage decrement would apply to the wrong org (the former owner's usage
    // would be decremented even though they no longer own the domain).
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL statement_timeout = $1', [30000]);

      // Lock the domain row atomically — verify ownership and non-archived in one step
      const { rows: lockRows } = await client.query(
        'SELECT 1 FROM domains WHERE id = $1 AND org_id = $2 AND archived_at IS NULL FOR UPDATE',
        [domainId, ctx['orgId']]
      );
      if (lockRows.length === 0) {
        await client.query('ROLLBACK');
        return errors.notFound(res, 'Domain');
      }

      // H11-FIX: Set archived_at so deleted domains are filtered from listings
      const deleteResult = await client.query(
        'UPDATE domains SET status = $1, archived_at = NOW(), updated_at = NOW() WHERE id = $2 AND org_id = $3',
        ['deleted', domainId, ctx['orgId']]
      );

      // DM-7-FIX (P1): Guard against null rowCount from pg driver
      if ((deleteResult.rowCount ?? 0) === 0) {
        // Race: domain was transferred or already deleted after the FOR UPDATE lock
        await client.query('ROLLBACK');
        return errors.notFound(res, 'Domain');
      }

      // Decrement usage count only when delete succeeded (within the same transaction)
      await client.query(
        `UPDATE org_usage SET domain_count = GREATEST(domain_count - 1, 0), updated_at = NOW()
        WHERE org_id = $1`,
        [ctx['orgId']]
      );

      await client.query('COMMIT');
      return { id: domainId, deleted: true };
    } catch (error) {
      try { await client.query('ROLLBACK'); } catch (rollbackError) {
        logger.error('Rollback failed during DELETE', rollbackError instanceof Error ? rollbackError : new Error(String(rollbackError)));
      }
      logger.error('[domains/:domainId DELETE] Error:', error instanceof Error ? error : new Error(String(error)));
      return errors.internal(res, 'Failed to delete domain');
    } finally {
      client.release();
    }
  } catch (error) {
    logger.error('[domains/:domainId DELETE] Auth/validation error:', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(res, 'Failed to delete domain');
  }
  });
}
