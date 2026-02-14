
import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

import { getDb } from '../db';
import { adminRateLimit } from '../middleware/rateLimiter';
import { sanitizeErrorMessage } from '@security/logger';
import { isValidUUID } from '@security/input-validator';
import { getLogger } from '@kernel/logger';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';

const logger = getLogger('AdminBilling');

/**
 * P0-FIX: Verify the specified organization exists and has active admin membership.
 *
 * SECURITY NOTE: These admin routes use a shared ADMIN_API_KEY (not per-user JWT),
 * so we cannot verify *which* admin is requesting. This function ensures the target
 * org_id is valid and has at least one admin member, preventing enumeration of
 * non-existent org IDs. For per-user access control, migrate to JWT-based auth
 * on admin routes so the requesting user's membership can be verified.
 */
async function verifyAdminOrgAccess(orgId: string): Promise<boolean> {
  if (!isValidUUID(orgId)) {
    return false;
  }
  const db = await getDb();
  const membership = await db('org_memberships')
    .where({ org_id: orgId })
    .whereIn('role', ['admin', 'owner'])
    .first();
  return !!membership;
}

/**
 * Admin Billing Routes
 * 
 * P1-HIGH SECURITY FIXES:
 * - Issue 3: Rate limit key collision - Add namespace prefix
 * - Issue 8: UUID validation inconsistency
 * - Issue 11: Inconsistent error response format
 * - Issue 20: Dynamic SQL without column whitelist
 * - Issue 22: Secrets exposed in error messages
 */

const OrgBillingInfoSchema = z.object({
  id: z.string().uuid(),
  plan: z.string(),
  plan_status: z.string(),
  created_at: z.date(),
});

const CountResultSchema = z.object({
  count: z.union([z.string(), z.number()]),
});

export type OrgBillingInfo = z.infer<typeof OrgBillingInfoSchema>;

function validateOrgBillingInfo(row: unknown): OrgBillingInfo {
  const result = OrgBillingInfoSchema.safeParse(row);
  if (!result.success) {
    throw new Error(`Invalid org billing info: ${JSON.stringify(result.error.format())}`);
  }
  return result.data;
}

function validateCountResult(row: unknown): { count: string | number } {
  const result = CountResultSchema.safeParse(row);
  if (!result.success) {
    throw new Error(`Invalid count result: ${result.success}`);
  }
  return result.data;
}

const AdminBillingQuerySchema = z.object({
  orgId: z.string().uuid(),
  limit: z.coerce.number().min(1).max(100).default(50),
  offset: z.coerce.number().min(0).default(0),
  // SECURITY FIX: Issue 20 - Whitelist allowed sort columns
  sortBy: z.enum(['created_at', 'plan', 'plan_status', 'id', 'name']).default('created_at'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

export type AdminBillingQueryType = z.infer<typeof AdminBillingQuerySchema>;

export interface AdminBillingResponse {
  data: OrgBillingInfo[];
  pagination: {
    limit: number;
    offset: number;
    total: number;
    hasMore: boolean;
  };
}

/**
 * Secure comparison for admin tokens
 * Uses timing-safe comparison to prevent timing attacks
 */
function secureCompareToken(token: string, expectedToken: string): boolean {
  const tokenBuf = Buffer.from(token, 'utf8');
  const expectedBuf = Buffer.from(expectedToken, 'utf8');
  const maxLen = Math.max(tokenBuf.length, expectedBuf.length);
  if (maxLen === 0) return false;
  const tokenPadded = Buffer.alloc(maxLen, 0);
  const expectedPadded = Buffer.alloc(maxLen, 0);
  tokenBuf.copy(tokenPadded);
  expectedBuf.copy(expectedPadded);
  const equal = crypto.timingSafeEqual(tokenPadded, expectedPadded);
  const sameLength = token.length === expectedToken.length;
  return equal && sameLength;
}

/**
 * SECURITY FIX: Issue 20 - Whitelist of allowed columns for dynamic queries
 * Prevents SQL injection via column names
 */
const ALLOWED_COLUMNS = new Set([
  'id', 'name', 'plan', 'plan_status', 'created_at', 'updated_at',
  'stripe_customer_id', 'billing_email', 'subscription_status'
]);

/**
 * Validate column name against whitelist
 * SECURITY FIX: Issue 20 - Column whitelist validation
 */
function validateColumnName(column: string): string {
  if (!ALLOWED_COLUMNS.has(column)) {
    throw new Error(`Invalid column name: ${column}`);
  }
  return column;
}

export async function adminBillingRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', adminRateLimit());

  app.addHook('onRequest', async (req, reply) => {
    // Check for admin authentication
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return errors.unauthorized(reply, 'Bearer token required.');
    }

    const token = authHeader.slice(7);
    try {
      // This should use the shared auth utility
      // For now, we check a simple admin token for protection
      if (!process.env['ADMIN_API_KEY']) {
        return errors.internal(reply, 'Admin API not configured');
      }
      if (!secureCompareToken(token, process.env['ADMIN_API_KEY'])) {
        return errors.forbidden(reply, 'Admin access required.');
      }
    } catch (err) {
      return errors.unauthorized(reply, 'Invalid token');
    }
  });

  app.get<{
    Querystring: AdminBillingQueryType;
    Reply: AdminBillingResponse | { error: string; code?: string; message?: string };
  }>('/admin/billing', async (
    req: FastifyRequest<{ Querystring: AdminBillingQueryType }>,
    reply: FastifyReply
  ): Promise<AdminBillingResponse | { error: string; code?: string; message?: string }> => {
    try {
      const db = await getDb();
      // Validate query parameters
      const parseResult = AdminBillingQuerySchema.safeParse(req.query);
      if (!parseResult.success) {
        return errors.validationFailed(reply, parseResult.error.issues);
      }

      const { limit, offset, sortBy, sortOrder } = parseResult.data;

      // SECURITY FIX: Issue 20 - Validate sort column against whitelist
      let validatedSortBy: string;
      try {
        validatedSortBy = validateColumnName(sortBy);
      } catch {
        return errors.badRequest(reply, 'Invalid sort column');
      }

      // P0-FIX: IDOR Vulnerability - Previously returned ALL orgs without tenant isolation
      // Now requires org_id parameter and filters by it
      const { orgId } = parseResult.data as { orgId: string };
      
      if (!orgId) {
        return errors.badRequest(reply, 'orgId parameter is required', ErrorCodes.MISSING_PARAMETER);
      }
      
      // P0-FIX: Org membership verification to prevent IDOR
      const hasAccess = await verifyAdminOrgAccess(orgId);
      if (!hasAccess) {
        return errors.forbidden(reply, 'Access denied to this organization');
      }
      
      // Get total count for pagination metadata with validation (filtered by org)
      const countResult = await db('orgs')
        .where({ id: orgId })
        .count('* as count');
      const validatedCount = validateCountResult(countResult[0]);
      const total = typeof validatedCount["count"] === 'string'
        ? parseInt(validatedCount["count"], 10)
        : validatedCount["count"];

      // P0-FIX: Filter by org_id - previously returned all orgs (IDOR vulnerability)
      const orgs = await db('orgs')
        .where({ id: orgId })
        .select('id', 'plan', 'plan_status', 'created_at')
        .orderBy(validatedSortBy, sortOrder)
        .limit(limit)
        .offset(offset);

      const validatedOrgs = orgs.map(validateOrgBillingInfo);

      return {
        data: validatedOrgs,
        pagination: {
          limit,
          offset,
          total,
          hasMore: offset + orgs.length < total
        }
      };
    } catch (error) {
      // SECURITY FIX: Issue 22 - Sanitize error messages before logging and returning
      const sanitizedError = sanitizeErrorMessage(error instanceof Error ? error["message"] : 'Failed to fetch billing data');
      logger.error('Error fetching billing data', undefined, { error: sanitizedError });

      return errors.internal(reply, 'Failed to fetch billing data');
    }
  });
  
  // SECURITY FIX: Issue 8 & 20 - Add endpoint for single org with UUID validation
  app.get<{
    Params: { id: string };
    Reply: OrgBillingInfo | { error: string; code?: string; message?: string };
  }>('/admin/billing/:id', async (
    req: FastifyRequest<{ Params: { id: string } }>,
    reply: FastifyReply
  ) => {
    try {
      const db = await getDb();
      const { id } = req.params;

      // SECURITY FIX: Issue 8 - Validate UUID format consistently
      if (!isValidUUID(id)) {
        return errors.badRequest(reply, 'Invalid organization ID format', ErrorCodes.INVALID_UUID);
      }

      // P0-FIX: Org access verification was missing on this endpoint (IDOR)
      const hasAccess = await verifyAdminOrgAccess(id);
      if (!hasAccess) {
        return errors.forbidden(reply, 'Access denied to this organization');
      }

      const org = await db('orgs')
        .select('id', 'plan', 'plan_status', 'created_at')
        .where({ id })
        .first();
      
      if (!org) {
        return errors.notFound(reply, 'Organization');
      }
      
      return validateOrgBillingInfo(org);
    } catch (error) {
      // SECURITY FIX: Issue 22 - Sanitize error messages
      const sanitizedError = sanitizeErrorMessage(error instanceof Error ? error["message"] : 'Failed to fetch organization');
      logger.error('Error fetching organization', undefined, { error: sanitizedError });

      return errors.internal(reply, 'Failed to fetch organization');
    }
  });
}
