


import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { z } from 'zod';

import { getLogger } from '@kernel/logger';

import { BillingService } from '../../services/billing';
import { enforceDomainLimit } from '../../services/quota';
import { getAuthContext } from '../types';
import { PricingUXService } from '../../services/pricing-ux';
import { requireRole } from '../../services/auth';
import { UsageService } from '../../services/usage';

const logger = getLogger('domains-routes');

const DomainNameSchema = z.string()
  .min(1, 'Domain name is required')
  .max(253, 'Domain name must be 253 characters or less')
  .regex(
  /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/,
  'Invalid domain name format'
  )
  .toLowerCase()
  .trim();

const CreateDomainBodySchema = z.object({
  name: DomainNameSchema,
  domainType: z.enum(['money', 'brand', 'test', 'redirect']).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const DomainParamsSchema = z.object({
  domainId: z.string().uuid('Domain ID must be a valid UUID'),
});

const UpdateDomainBodySchema = z.object({
  name: DomainNameSchema.optional(),
  domainType: z.enum(['money', 'brand', 'test', 'redirect']).optional(),
  status: z.enum(['active', 'inactive', 'pending', 'suspended']).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
}).refine(
  (data) => Object.keys(data).length > 0,
  { message: 'At least one field must be provided for update' }
);

const DomainQuerySchema = z.object({
  status: z.enum(['active', 'inactive', 'pending', 'suspended', 'all']).optional().default('all'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export async function domainRoutes(app: FastifyInstance, pool: Pool) {
  const billing = new BillingService(pool);
  const usage = new UsageService(pool);
  const pricing = new PricingUXService(billing, usage);

  // GET /domains - List all domains for the organization
  app.get('/domains', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);

  // Validate orgId
  if (!ctx?.["orgId"]) {
    return res.status(400).send({ error: 'Organization ID is required' });
  }

  const orgIdResult = z.string().uuid().safeParse(ctx["orgId"]);
  if (!orgIdResult.success) {
    return res.status(400).send({
    error: 'Invalid organization ID',
    code: 'VALIDATION_ERROR',
    });
  }

  // Validate query params
  const queryResult = DomainQuerySchema.safeParse(req.query);
  const { status, page, limit } = queryResult.success ? queryResult.data :
    { status: 'all', page: 1, limit: 20 };

  const offset = (page - 1) * limit;

  try {
    let query = `
    d["id"], d.name, d.status, d.created_at, d.updated_at,
    dr.domain_type, dr.revenue_confidence, dr.replaceability
    FROM domains d
    LEFT JOIN domain_registry dr ON d["id"] = dr["id"]
    WHERE d.org_id = $1
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
    id: row["id"],
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
    logger["error"]('[domains] Error:', error instanceof Error ? error : new Error(String(error)));
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to fetch domains' });
  }
  });

  // GET /domains/allowance - Get domain allowance for organization
  app.get('/domains/allowance', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin']);

  // Validate orgId
  if (!ctx?.["orgId"]) {
    return res.status(400).send({ error: 'Organization ID is required' });
  }

  const orgIdResult = z.string().uuid().safeParse(ctx["orgId"]);
  if (!orgIdResult.success) {
    return res.status(400).send({
    error: 'Invalid organization ID',
    code: 'VALIDATION_ERROR',
    });
  }

  return pricing.getDomainAllowance(ctx["orgId"]);
  });

  // POST /domains - Create a new domain
  app.post('/domains', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin']);

  // Validate orgId
  if (!ctx?.["orgId"]) {
    return res.status(400).send({ error: 'Organization ID is required' });
  }

  const orgIdResult = z.string().uuid().safeParse(ctx["orgId"]);
  if (!orgIdResult.success) {
    return res.status(400).send({
    error: 'Invalid organization ID',
    code: 'VALIDATION_ERROR',
    });
  }

  // Validate body
  const bodyResult = CreateDomainBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: bodyResult["error"].issues,
    });
  }

  const { name, domainType } = bodyResult.data;

  // SECURITY FIX: Use transaction with SELECT FOR UPDATE to prevent race condition
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL statement_timeout = $1', [30000]); // 30 seconds

    // Lock the org_usage row to prevent concurrent quota checks
    const { rows: usageRows } = await client.query(
    'SELECT domain_count FROM org_usage WHERE org_id = $1 FOR UPDATE',
    [ctx["orgId"]]
    );

    const currentDomainCount = usageRows[0]?.["domain_count"] ?? 0;

    // Check quota within the same transaction
    const plan = await billing.getActivePlan(ctx["orgId"]);
    const maxDomains = plan?.max_domains;

    if (maxDomains !== null && maxDomains !== undefined && currentDomainCount >= maxDomains) {
    await client.query('ROLLBACK');
    return res.status(402).send({
    error: 'Domain limit exceeded',
    code: 'QUOTA_EXCEEDED',
    current: currentDomainCount,
    limit: maxDomains,
    });
    }

    const domainId = randomUUID();

    // Insert into domains table
    await client.query(
    `INSERT INTO domains (id, org_id, name, status, created_at, updated_at)
    VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [domainId, ctx["orgId"], name, 'active']
    );

    // Insert into domain_registry if domain type provided
    if (domainType) {
    await client.query(
    'INSERT INTO domain_registry (id, org_id, domain_type) VALUES ($1, $2, $3)',
    [domainId, ctx["orgId"], domainType]
    );
    } else {
    await client.query(
    'INSERT INTO domain_registry (id, org_id) VALUES ($1, $2)',
    [domainId, ctx["orgId"]]
    );
    }

    // Increment usage count
    await client.query(
    `INSERT INTO org_usage (org_id, domain_count, updated_at)
    VALUES ($1, 1, NOW())
    ON CONFLICT (org_id)
    DO UPDATE SET domain_count = org_usage["domain_count"] + 1, updated_at = NOW()`,
    [ctx["orgId"]]
    );

    await client.query('COMMIT');
    return { id: domainId, name, status: 'active' };
  } catch (error) {
    await client.query('ROLLBACK');
    logger["error"]('[domains POST] Error:', error instanceof Error ? error : new Error(String(error)));
    return res.status(500).send({ error: 'Failed to create domain' });
  } finally {
    client.release();
  }
  });

  // GET /domains/:domainId - Get a specific domain
  app.get('/domains/:domainId', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin', 'editor', 'viewer']);

  // Validate orgId
  if (!ctx?.["orgId"]) {
    return res.status(400).send({ error: 'Organization ID is required' });
  }

  // Validate params
  const paramsResult = DomainParamsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).send({
    error: 'Invalid domain ID',
    code: 'VALIDATION_ERROR',
    details: paramsResult["error"].issues,
    });
  }

  const { domainId } = paramsResult.data;

  // Verify domain ownership
  const { rows: domainRows } = await pool.query(
    'SELECT 1 FROM domains WHERE id = $1 AND org_id = $2',
    [domainId, ctx["orgId"]]
  );

  if (domainRows.length === 0) {
    return res.status(403).send({ error: 'Access denied to domain' });
  }

  try {
    const { rows } = await pool.query(
    `SELECT
    d["id"], d.name, d.status, d.created_at, d.updated_at,
    dr.domain_type, dr.revenue_confidence, dr.replaceability
    FROM domains d
    LEFT JOIN domain_registry dr ON d["id"] = dr["id"]
    WHERE d["id"] = $1 AND d.org_id = $2`,
    [domainId, ctx["orgId"]]
    );

    if (rows.length === 0) {
    return res.status(404).send({ error: 'Domain not found' });
    }

    const row = rows[0];
    return {
    id: row["id"],
    name: row.name,
    status: row.status,
    domainType: row.domain_type,
    revenueConfidence: row.revenue_confidence,
    replaceability: row.replaceability,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    };
  } catch (error) {
    logger["error"]('[domains/:domainId] Error:', error instanceof Error ? error : new Error(String(error)));
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to fetch domain' });
  }
  });

  // PATCH /domains/:domainId - Update a domain
  app.patch('/domains/:domainId', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner', 'admin']);

  // Validate orgId
  if (!ctx?.["orgId"]) {
    return res.status(400).send({ error: 'Organization ID is required' });
  }

  // Validate params
  const paramsResult = DomainParamsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).send({
    error: 'Invalid domain ID',
    code: 'VALIDATION_ERROR',
    details: paramsResult["error"].issues,
    });
  }

  // Validate body
  const bodyResult = UpdateDomainBodySchema.safeParse(req.body);
  if (!bodyResult.success) {
    return res.status(400).send({
    error: 'Validation failed',
    code: 'VALIDATION_ERROR',
    details: bodyResult["error"].issues,
    });
  }

  const { domainId } = paramsResult.data;
  const updateData = bodyResult.data;

  // Verify domain ownership
  const { rows: domainRows } = await pool.query(
    'SELECT 1 FROM domains WHERE id = $1 AND org_id = $2',
    [domainId, ctx["orgId"]]
  );

  if (domainRows.length === 0) {
    return res.status(403).send({ error: 'Access denied to domain' });
  }

  try {
    // Build update query dynamically
    const updates: string[] = [];
    const values: unknown[] = [];
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
    values.push(domainId);

    if (updates.length > 0) {
    await pool.query(
    `UPDATE domains SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
    );
    }

    // Update domain_registry if domainType provided
    if (updateData.domainType !== undefined) {
    await pool.query(
    'UPDATE domain_registry SET domain_type = $1 WHERE id = $2',
    [updateData.domainType, domainId]
    );
    }

    return { id: domainId, updated: true };
  } catch (error) {
    logger["error"]('[domains/:domainId PATCH] Error:', error instanceof Error ? error : new Error(String(error)));
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to update domain' });
  }
  });

  // DELETE /domains/:domainId - Delete a domain (soft delete)
  app.delete('/domains/:domainId', async (req, res) => {
  const ctx = getAuthContext(req);
  requireRole(ctx, ['owner']);

  // Validate orgId
  if (!ctx?.["orgId"]) {
    return res.status(400).send({ error: 'Organization ID is required' });
  }

  // Validate params
  const paramsResult = DomainParamsSchema.safeParse(req.params);
  if (!paramsResult.success) {
    return res.status(400).send({
    error: 'Invalid domain ID',
    code: 'VALIDATION_ERROR',
    details: paramsResult["error"].issues,
    });
  }

  const { domainId } = paramsResult.data;

  // Verify domain ownership
  const { rows: domainRows } = await pool.query(
    'SELECT 1 FROM domains WHERE id = $1 AND org_id = $2',
    [domainId, ctx["orgId"]]
  );

  if (domainRows.length === 0) {
    return res.status(403).send({ error: 'Access denied to domain' });
  }

  try {
    await pool.query(
    'UPDATE domains SET status = $1, updated_at = NOW() WHERE id = $2',
    ['inactive', domainId]
    );

    await usage.increment(ctx["orgId"], 'domain_count', -1);

    return { id: domainId, deleted: true };
  } catch (error) {
    logger["error"]('[domains/:domainId DELETE] Error:', error instanceof Error ? error : new Error(String(error)));
    // FIX: Added return before reply.send()
    return res.status(500).send({ error: 'Failed to delete domain' });
  }
  });
}
