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
import { verifyOrgMembership } from '../services/membership';
import { errors } from '@errors/responses';

const billingInvoiceExportLogger = getLogger('billingInvoiceExport');

// MEDIUM FIX C2: Replace direct process.env with validated config
// P3-FIX: Read apiVersion from config rather than hardcoding it here, so all
// Stripe client instances in the codebase stay in sync via a single change.
const billingConfig = getBillingConfig();
const stripe = new Stripe(billingConfig.stripeSecretKey, {
  apiVersion: billingConfig.stripeApiVersion,
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
  const token = authHeader.slice(7);
  return token || null;
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
    // P1-FIX (P1-1): Validate JWT claims with Zod instead of unsafe `as` cast.
    // A JWT whose `sub` is a number (spec allows it) or lacks `orgId` would have
    // passed the old cast silently, setting user.id to a non-string and potentially
    // bypassing downstream string-equality membership checks.
    const ExportClaimsSchema = z.object({
      sub: z.string().min(1),
      orgId: z.string().min(1),
      stripeCustomerId: z.string().optional(),
    });
    const claimsResult = ExportClaimsSchema.safeParse(result.claims);
    if (!claimsResult.success) {
      return errors.unauthorized(reply, 'Invalid token claims');
    }
    const { sub, orgId, stripeCustomerId } = claimsResult.data;

    (req as AuthenticatedRequest).user = {
      id: sub,
      orgId,
      stripeCustomerId,
    };
  } catch {
    return errors.unauthorized(reply, 'Invalid token');
  }
  });

  // P1-FIX: Add membership verification hook.
  // P1-FIX (security): The previous guard used `if (!orgId || !userId) return` which
  // allowed a JWT containing orgId but no `sub` claim (userId) to skip membership
  // verification entirely. Both fields are now required; absence of either is treated
  // as an authentication failure, not a "user-level billing" path.
  app.addHook('onRequest', async (req, reply) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    const orgId = authReq.user?.orgId;

    if (!orgId || !userId) {
      return errors.unauthorized(reply, 'Authentication required');
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

    // P0-FIX (P0-3): Never trust stripeCustomerId from the JWT claim — an attacker
    // with any valid token can forge that claim to access another org's invoices (IDOR).
    // Always re-fetch the Stripe customer ID from the database using the verified orgId.
    const orgId = authReq.user?.orgId;
    if (!orgId) {
      return errors.unauthorized(reply);
    }
    const exportDb = await getDb();
    const orgRow = await exportDb('organizations')
      .where({ id: orgId })
      .select('stripe_customer_id')
      .first();
    const customerId: string | undefined = orgRow?.['stripe_customer_id'];
    if (!customerId) {
      // Org has no Stripe customer yet — return empty CSV rather than an error.
      const headers = ['id', 'number', 'amount_paid', 'created'];
      return reply
        .header('Content-Type', 'text/csv')
        .header('Content-Disposition', 'attachment; filename="invoices.csv"')
        .header('X-Content-Type-Options', 'nosniff')
        .send(headers.join(',') + '\n');
    }

    const { format } = parseResult.data;

    const invoices = await stripe.invoices.list({
    customer: customerId,
    limit: 50
    });

    if (format === 'pdf') {
    // P2-FIX (P2-4): Return 501 Not Implemented instead of 200 with a string body.
    // Sending 200 with Content-Type: application/pdf but a UTF-8 string body causes
    // PDF clients to crash or silently produce a corrupt file.
    return reply.status(501).send({ error: 'PDF export not yet supported', code: 'NOT_IMPLEMENTED' });
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
