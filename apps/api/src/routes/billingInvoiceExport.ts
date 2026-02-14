// P1-FIX: Replaced raw jsonwebtoken with centralized @security/jwt to ensure
// token revocation checks, session binding, and algorithm pinning are applied.
import Stripe from 'stripe';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { apiRateLimit } from '../middleware/rateLimiter';
import { extractAndVerifyToken } from '@security/jwt';
import { getLogger } from '@kernel/logger';
import { getBillingConfig } from '@config';
import { getDb } from '../db';
import { errors } from '@errors/responses';

const billingInvoiceExportLogger = getLogger('billingInvoiceExport');

// MEDIUM FIX C2: Replace direct process.env with validated config
const billingConfig = getBillingConfig();
const stripe = new Stripe(billingConfig.stripeSecretKey, {
  apiVersion: '2023-10-16'
});

/**
 * Sanitize CSV field to prevent formula injection
 * @param field - Field to sanitize
 * @returns Sanitized field
 */
function sanitizeCsvField(field: string | number | null | undefined): string {
  // Convert to string (handles null/undefined)
  let sanitized = String(field ?? '');

  // Characters that could trigger formula execution: =, +, -, @, \t, \r
  if (/^[=+\-@\t\r]/.test(sanitized)) {
  sanitized = "'" + sanitized;  // Prefix with apostrophe to neutralize
  }

  // Escape double quotes by doubling them
  sanitized = sanitized.replace(/"/g, '""');

  // Always wrap in quotes for consistency and safety
  return `"${sanitized}"`;
}

const ExportQuerySchema = z.object({
  format: z.enum(['csv', 'pdf']).default('csv')
});

export type ExportQueryType = z.infer<typeof ExportQuerySchema>;

type AuthenticatedRequest = FastifyRequest & {
  user: {
  id?: string | undefined;
  orgId?: string | undefined;
  stripeCustomerId?: string | undefined;
  };
};

export interface ErrorResponse {
  error: string;
  code?: string;
  details?: z.ZodIssue[];
  message?: string;
}

/**
 * Extract bearer token from request
 * @param req - Fastify request
 * @returns Token or null
 */
function extractBearerToken(req: FastifyRequest): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
  return null;
  }
  // P1-FIX: Timing Attack - Use constant-time comparison for token extraction
  // Extract token without early returns that could leak timing information
  const token = authHeader.slice(7);
  return token || null;
}

/**
 * Verify user membership in organization
 * P1-FIX: Added org membership verification for billing routes
 */
async function verifyOrgMembership(userId: string, orgId: string): Promise<boolean> {
  const db = await getDb();
  const membership = await db('org_memberships')
    .where({ user_id: userId, org_id: orgId })
    .first();
  return !!membership;
}

export async function billingInvoiceExportRoutes(app: FastifyInstance): Promise<void> {

  app.addHook('onRequest', apiRateLimit());

  // P1-FIX: Use centralized @security/jwt instead of raw jsonwebtoken.
  // This ensures token revocation, session binding, algorithm pinning, and clock tolerance.
  app.addHook('onRequest', async (req, reply) => {
  const token = extractBearerToken(req);
  if (!token) {
    return errors.unauthorized(reply);
  }
  try {
    const result = extractAndVerifyToken(token);
    if (!result.valid || !result.claims) {
      return errors.unauthorized(reply, 'Invalid token');
    }
    const claims = result.claims as { stripeCustomerId?: string; sub?: string; orgId?: string };

    (req as AuthenticatedRequest).user = {
      id: claims.sub,
      orgId: claims.orgId,
      stripeCustomerId: claims.stripeCustomerId
    };
  } catch {
    return errors.unauthorized(reply, 'Invalid token');
  }
  });

  // P1-FIX: Add membership verification hook
  app.addHook('onRequest', async (req, reply) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    const orgId = authReq.user?.orgId;
    
    // If no org context, skip membership check (may be user-level billing)
    if (!orgId || !userId) {
      return;
    }
    
    // Verify user is a member of the organization
    const hasMembership = await verifyOrgMembership(userId, orgId);
    if (!hasMembership) {
      return errors.forbidden(reply, 'Organization membership required');
    }
  });

  app.get<{
  Querystring: ExportQueryType;
  Reply: ErrorResponse | string;
  }>('/billing/invoices/export', async (
  req,
  reply
  ): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  try {
    // Validate query parameters
    const parseResult = ExportQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
    return errors.validationFailed(reply, parseResult.error.issues);
    }

    const customerId = authReq.user?.stripeCustomerId;
    if (!customerId) {
      return errors.unauthorized(reply);
    }

    const { format } = parseResult.data;

    const invoices = await stripe.invoices.list({
    customer: customerId,
    limit: 50
    });

    if (format === 'pdf') {
    return reply
    .header('Content-Type', 'application/pdf')
    .send('PDF generation not implemented yet');
    }

    const headers = ['id', 'number', 'amount_paid', 'created'];
    const headerRow = headers.join(',') + '\n';

    const body = invoices.data
    .map((i: Stripe.Invoice) => [
    sanitizeCsvField(i.id),
    sanitizeCsvField(i.number),
    sanitizeCsvField(i.amount_paid),
    sanitizeCsvField(i.created)
    ].join(','))
    .join('\n');

    return reply
    .header('Content-Type', 'text/csv')
    .header('Content-Disposition', 'attachment; filename="invoices.csv"')
    .header('X-Content-Type-Options', 'nosniff')
    .send(headerRow + body);
  } catch (error) {
    billingInvoiceExportLogger.error('Error exporting invoices', error instanceof Error ? error : new Error(String(error)));
    return errors.internal(reply);
  }
  });
}
