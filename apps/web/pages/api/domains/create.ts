import type { NextApiRequest, NextApiResponse } from 'next';
import { randomUUID } from 'crypto';

import { pool } from '../../../lib/db';
import { rateLimit } from '../../../lib/rate-limit';
import { requireAuth, validateMethod, requireOrgAdmin, sendError } from '../../../lib/auth';
import { getLogger } from '@kernel/logger';

const logger = getLogger('DomainCreate');

/**
* POST /api/domains/create
* Create a new domain with quota check using SELECT FOR UPDATE
* SECURITY FIX: P1-HIGH Issue 1 - Race Condition in Domain Creation
* Uses row-level locking to prevent concurrent quota bypass
*/



// Domain name validation regex (alphanumeric, hyphens, max 63 chars per label)
const DOMAIN_NAME_REGEX = /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
const MAX_DOMAIN_LENGTH = 253;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['POST'])) return;

  try {
    // RATE LIMITING: Strict rate limit for domain creation (5 req/min)
    const allowed = await rateLimit('domains:create', 5, req, res);
    if (!allowed) return;

    // Authenticate request
    const auth = await requireAuth(req, res);
    if (!auth) return;

    // Require org admin for domain creation
    try {
    await requireOrgAdmin(auth, res);
    } catch {
    logger.warn('Non-admin user attempted to create domain', { userId: auth.userId });
    return;
    }

    const { name, description } = req.body;

    // Validate domain name
    if (!name || typeof name !== 'string') {
    return sendError(res, 400, 'Domain name is required');
    }

    if (name.length > MAX_DOMAIN_LENGTH) {
    return sendError(res, 400, `Domain name must be less than ${MAX_DOMAIN_LENGTH} characters`);
    }

    if (!DOMAIN_NAME_REGEX.test(name)) {
    return sendError(res, 400, 'Invalid domain name format');
    }

    // Validate description if provided
    if (description !== undefined && typeof description !== 'string') {
    return sendError(res, 400, 'Description must be a string');
    }
    if (description && description.length > 1000) {
    return sendError(res, 400, 'Description must be less than 1000 characters');
    }

    const client = await pool.connect();

    try {
    // SECURITY FIX: Use transaction with SELECT FOR UPDATE to prevent race condition
    await client.query('BEGIN');

    // Lock the org's quota row for update - prevents concurrent domain creation
    const { rows: quotaRows } = await client.query(
        `SELECT domain_count, max_domains
        FROM org_quotas
        WHERE org_id = $1
        FOR UPDATE`,
        [auth["orgId"]]
    );

    let currentCount: number;
    let maxDomains: number;

    if (quotaRows.length === 0) {
        // No quota row exists - create one with default limits
        currentCount = 0;
        maxDomains = getDefaultMaxDomains(auth.roles);

        await client.query(
        `INSERT INTO org_quotas (org_id, domain_count, max_domains, created_at, updated_at)
        VALUES ($1, 0, $2, NOW(), NOW())`,
        [auth["orgId"], maxDomains]
        );
    } else {
        currentCount = parseInt(quotaRows[0].domain_count, 10);
        maxDomains = parseInt(quotaRows[0].max_domains, 10);
    }

    // Check if quota exceeded
    if (currentCount >= maxDomains) {
        await client.query('ROLLBACK');
        logger.warn('Domain quota exceeded', { orgId: auth["orgId"], currentCount, maxDomains });
        return sendError(res, 403, 'Domain quota exceeded. Please upgrade your plan.');
    }

    // Check for duplicate domain name
    const { rows: existingRows } = await client.query(
        'SELECT id FROM domain_registry WHERE domain_name = $1 AND status != $2',
        [name.toLowerCase(), 'archived']
    );

    if (existingRows.length > 0) {
        await client.query('ROLLBACK');
        return sendError(res, 409, 'Domain name already exists');
    }

    // Create the domain
    const domainId = randomUUID();
    const now = new Date();

    await client.query(
        `INSERT INTO domain_registry (
        domain_id, org_id, domain_name, description,
        status, created_at, updated_at, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $6, $7)`,
        [domainId, auth["orgId"], name.toLowerCase(), description || '', 'active', now, auth.userId]
    );

    // Increment domain count
    await client.query(
        `UPDATE org_quotas
        SET domain_count = domain_count + 1, updated_at = NOW()
        WHERE org_id = $1`,
        [auth["orgId"]]
    );

    await client.query('COMMIT');

    // Security audit log
    logger.info('Domain created', { domainId, name, userId: auth.userId, orgId: auth["orgId"] });

    res.status(201).json({
        id: domainId,
        name: name.toLowerCase(),
        description: description || '',
        status: 'active',
        createdAt: now.toISOString(),
        quota: {
        used: currentCount + 1,
        max: maxDomains
        }
    });

    } catch (error) {
      // CRITICAL FIX: Log rollback failures instead of silently ignoring
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        logger.error('Rollback failed', rollbackError instanceof Error ? rollbackError : undefined, { error: String(rollbackError) });
        
        // Chain errors for debugging
        const originalMsg = error instanceof Error ? error.message : String(error);
        const rollbackMsg = rollbackError instanceof Error 
          ? rollbackError.message 
          : String(rollbackError);
        
        throw new Error(
          `Domain creation failed: ${originalMsg}. ` +
          `Additionally, rollback failed: ${rollbackMsg}`
        );
      }
      throw error;
    } finally {
      client.release();
    }

  } catch (error: unknown) {
    logger.error('Failed to create domain', error instanceof Error ? error : undefined, { error: String(error) });

    // Sanitize error for client
    const message = error instanceof Error ? error.message : '';
    if (message.includes('DATABASE_NOT_CONFIGURED')) {
    return sendError(res, 503, 'Service unavailable. Database not configured.');
    }

    // Generic error to prevent information leakage
    sendError(res, 500, 'Internal server error. Failed to create domain.');
  }
}

function getDefaultMaxDomains(roles: string[]): number {
  // Default domain limits based on highest role
  if (roles.includes('admin')) {
    return 10;
  }
  if (roles.includes('editor')) {
    return 5;
  }
  return 3;
}
