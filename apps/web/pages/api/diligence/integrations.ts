
import type { NextApiRequest, NextApiResponse } from 'next';

import { requireAuth, validateMethod, canAccessDomain, sendError } from '../../../lib/auth';
import { pool } from '../../../lib/db';
import { getLogger } from '@kernel/logger';

const logger = getLogger('diligence:integrations');

/**
* GET /api/diligence/integrations
* Return buyer-safe integrations summary (no secrets)
* Requires authentication and domain access if domainId is provided
*/

// UUID validation regex
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface IntegrationRecord {
  provider: string;
  status: string;
  connected_at: Date;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['GET'])) return;

  try {
  // Authenticate request
  const auth = await requireAuth(req, res);
  if (!auth) return;

  const { domainId } = req.query;

  // Validate domainId if provided
  if (domainId !== undefined && domainId !== '') {
    // Handle both string and array cases
    const domainIdStr = Array.isArray(domainId) ? domainId[0] : domainId;

    if (!domainIdStr) {
    return sendError(res, 400, 'Invalid domainId.');
    }

    // Validate UUID format
    if (!UUID_REGEX.test(domainIdStr)) {
    return sendError(res, 400, 'Invalid domainId format. Expected UUID.');
    }

    // AUTHORIZATION CHECK: Verify user has access to the domain
    const hasAccess = await canAccessDomain(auth.userId, domainIdStr, pool);
    if (!hasAccess) {
    logger.warn('Unauthorized access attempt', { userId: auth.userId, domainId: domainIdStr });
    return sendError(res, 403, 'Access denied to domain');
    }
  }

  // Fetch organization-level integrations from database
  let orgIntegrations: IntegrationRecord[] = [];
  let domainIntegrations: IntegrationRecord[] = [];

  try {
    // Fetch org-level integrations
    const orgResult = await pool.query<IntegrationRecord>(
    `SELECT provider, status, connected_at
    FROM organization_integrations
    WHERE org_id = $1 AND status = 'connected'
    ORDER BY provider`,
    [auth.orgId]
    );
    orgIntegrations = orgResult.rows;
  } catch (dbError: unknown) {
    // Table may not exist yet (42P01) - log but don't fail
    // P2-4 FIX: Re-throw non-table-missing errors instead of silently swallowing
    const err = dbError as { code?: string; message?: string };
    if (err.code === '42P01') {
    // Table doesn't exist yet - expected during development
    } else {
    logger.error('Error fetching org integrations', undefined, { error: err.message });
    throw dbError;
    }
  }

  // Fetch domain-level integrations if domainId provided and authorized
  if (domainId) {
    const domainIdStr = Array.isArray(domainId) ? domainId[0] : domainId;

    try {
    const domainResult = await pool.query<IntegrationRecord>(
      `SELECT provider, status, connected_at
      FROM domain_integrations
      WHERE domain_id = $1 AND status = 'connected'
      ORDER BY provider`,
      [domainIdStr]
    );
    domainIntegrations = domainResult.rows;
    } catch (dbError: unknown) {
    // P2-4 FIX: Re-throw non-table-missing errors instead of silently swallowing
    const err = dbError as { code?: string; message?: string };
    if (err.code === '42P01') {
      // Table doesn't exist yet - expected during development
    } else {
      logger.error('Error fetching domain integrations', undefined, { error: err.message });
      throw dbError;
    }
    }
  }

  // Format response - buyer-safe (no secrets, tokens, or credentials)
  const integrations = {
    organization: orgIntegrations.length > 0
    ? orgIntegrations.map(i => ({
      provider: i.provider,
      status: i.status,
      connectedAt: i.connected_at?.toISOString() ?? null,
      }))
    : [
      // Fallback placeholder data for development/testing
      { provider: 'Ahrefs', status: 'disconnected', connectedAt: null },
      { provider: 'Stripe', status: 'disconnected', connectedAt: null }
      ],
    domain: domainIntegrations.length > 0
    ? domainIntegrations.map(i => ({
      provider: i.provider,
      status: i.status,
      connectedAt: i.connected_at?.toISOString() ?? null,
      }))
    : domainId
      ? [
        // Fallback placeholder data for development/testing
        { provider: 'Google Search Console', status: 'disconnected', connectedAt: null },
        { provider: 'Amazon Associates', status: 'disconnected', connectedAt: null }
      ]
      : []
  };

  res.json(integrations);
  } catch (error: unknown) {
  if (error instanceof Error && error.name === 'AuthError') return;
  logger.error('Error fetching integrations', error instanceof Error ? error : undefined, { error: String(error) });

  if (error instanceof Error && error.message?.includes('DATABASE_NOT_CONFIGURED')) {
    return sendError(res, 503, 'Service unavailable. Database not configured.');
  }

  sendError(res, 500, 'Internal server error. Failed to fetch integrations');
  }
}
