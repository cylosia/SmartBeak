
import type { NextApiRequest, NextApiResponse } from 'next';

import { requireAuth, validateMethod, canAccessDomain, sendError } from '../../../lib/auth';
import { pool } from '../../../lib/db';

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
    console.warn(`[diligence/integrations] Unauthorized access attempt: user ${auth.userId} tried to access integrations for domain ${domainIdStr}`);
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
    [auth["orgId"]]
    );
    orgIntegrations = orgResult.rows;
  } catch (dbError: any) {
    // Table may not exist yet - log but don't fail
    if (dbError.code !== '42P01') {
    console.warn('[diligence/integrations] Error fetching org integrations:', dbError.message);
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
    } catch (dbError: any) {
    // Table may not exist yet - log but don't fail
    if (dbError.code !== '42P01') {
      console.warn('[diligence/integrations] Error fetching domain integrations:', dbError.message);
    }
    }
  }

  // Format response - buyer-safe (no secrets, tokens, or credentials)
  const integrations = {
    organization: orgIntegrations.length > 0
    ? orgIntegrations.map(i => ({
      provider: i.provider,
      status: i.status,
      connectedAt: i.connected_at.toISOString(),
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
      connectedAt: i.connected_at.toISOString(),
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
  console.error('[diligence/integrations] Error:', error);

  if (error instanceof Error && error.message?.includes('DATABASE_NOT_CONFIGURED')) {
    return sendError(res, 503, 'Service unavailable. Database not configured.');
  }

  sendError(res, 500, 'Internal server error. Failed to fetch integrations');
  }
}
