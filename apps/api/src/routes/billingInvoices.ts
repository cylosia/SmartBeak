import Stripe from 'stripe';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { verifyToken, extractBearerToken as extractTokenFromHeader, TokenExpiredError, TokenInvalidError, } from '@security/jwt';
import { getLogger } from '@kernel/logger';
import { getDb } from '../db';
import { errors, sendError } from '@errors/responses';
import { ErrorCodes } from '@errors';

const billingInvoicesLogger = getLogger('billingInvoices');

// Stripe key is validated at startup in config/index.ts
const stripeKey = process.env['STRIPE_SECRET_KEY'];
if (!stripeKey) {
  throw new Error('STRIPE_SECRET_KEY environment variable is required');
}
const stripe = new Stripe(stripeKey, {
  apiVersion: '2023-10-16'
});

const QuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(10),
  startingAfter: z.string().regex(/^in_[A-Za-z0-9_-]+$/).optional(),
});

export type QueryType = z.infer<typeof QuerySchema>;

/**
* JWT claims with optional Stripe customer ID
*/
export interface JwtClaims {
  sub?: string | undefined;
  orgId?: string | undefined;
  [key: string]: unknown;
}

type AuthenticatedRequest = FastifyRequest & {
  user: {
  id?: string | undefined;
  orgId?: string | undefined;
  };
};

// P0-FIX: Removed stripeCustomerId from InvoiceResponse — now returns a safe DTO.
export interface InvoiceDto {
  id: string | null;
  number: string | null;
  amountPaid: number;
  amountDue: number;
  currency: string;
  status: Stripe.Invoice.Status | null;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  createdAt: string | null;
  dueDate: string | null;
  description: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

export interface InvoiceResponse {
  invoices: InvoiceDto[];
  hasMore: boolean;
}

export interface ErrorResponse {
  error: string;
  code: string;
}

/**
 * Verify user membership in organization
 */
async function verifyOrgMembership(userId: string, orgId: string): Promise<boolean> {
  const db = await getDb();
  const membership = await db('org_memberships')
    .where({ user_id: userId, org_id: orgId })
    .first();
  return !!membership;
}

export async function billingInvoiceRoutes(app: FastifyInstance): Promise<void> {

  app.addHook('onRequest', async (req, reply) => {
  const authHeader = req.headers.authorization;
  const token = extractTokenFromHeader(authHeader);

  if (!token) {
    return errors.unauthorized(reply);
  }

  try {
    // Use unified auth package for token verification
    const claims = verifyToken(token) as JwtClaims;

    (req as AuthenticatedRequest).user = {
      id: claims.sub,
      orgId: claims.orgId,
    };
  } catch (error) {
    if (error instanceof TokenExpiredError) {
    return errors.unauthorized(reply, 'Token expired');
    }
    if (error instanceof TokenInvalidError) {
    return errors.unauthorized(reply, 'Invalid token');
    }
    return errors.unauthorized(reply, 'Authentication failed');
  }
  });

  // Require orgId and verify membership before any route handler runs.
  app.addHook('onRequest', async (req, reply) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    const orgId = authReq.user?.orgId;

    if (!userId) {
      return errors.unauthorized(reply, 'Authentication required');
    }
    if (!orgId) {
      return errors.forbidden(reply, 'Organization context required for billing access');
    }

    const hasMembership = await verifyOrgMembership(userId, orgId);
    if (!hasMembership) {
      return errors.forbidden(reply, 'Forbidden');
    }
  });

  app.get<{
  Querystring: QueryType;
  Reply: InvoiceResponse | ErrorResponse;
  }>('/billing/invoices', async (
  req,
  reply
  ): Promise<InvoiceResponse | ErrorResponse> => {
  const authReq = req as AuthenticatedRequest;
  try {
    // Validate query params
    const queryResult = QuerySchema.safeParse(req.query);
    if (!queryResult.success) {
    return errors.badRequest(reply, 'Invalid query parameters');
    }

    const { limit, startingAfter } = queryResult.data;

    // P0-FIX: Fetch stripeCustomerId from the database using the verified orgId.
    // Never trust the JWT claim — an attacker with a valid token could supply any
    // stripeCustomerId and pivot to another organization's invoice history (IDOR).
    const orgId = authReq.user?.orgId;
    if (!orgId) {
      return errors.unauthorized(reply);
    }
    const db = await getDb();
    const orgRow = await db('organizations')
      .where({ id: orgId })
      .select('stripe_customer_id')
      .first();
    const customerId: string | undefined = orgRow?.['stripe_customer_id'];
    if (!customerId) {
      // Org has no Stripe customer yet — return empty list, not an error.
      return reply.status(200).send({ invoices: [], hasMore: false });
    }

    const invoices = await stripe.invoices.list({
    customer: customerId,
    limit,
    starting_after: startingAfter ?? undefined,
    } as Stripe.InvoiceListParams);

    // P2-FIX: Map to a minimal DTO — the raw Stripe.Invoice type exposes sensitive
    // internal fields (payment_intent, default_payment_method, customer_tax_ids,
    // metadata, full line items) that must not reach the client.
    const invoiceDtos: InvoiceDto[] = invoices.data.map((inv: Stripe.Invoice) => ({
      id: inv.id,
      number: inv.number,
      amountPaid: inv.amount_paid,
      amountDue: inv.amount_due,
      currency: inv.currency,
      status: inv.status,
      hostedInvoiceUrl: inv.hosted_invoice_url ?? null,
      invoicePdf: inv.invoice_pdf ?? null,
      createdAt: inv.created ? new Date(inv.created * 1000).toISOString() : null,
      dueDate: inv.due_date ? new Date(inv.due_date * 1000).toISOString() : null,
      description: inv.description ?? null,
      periodStart: inv.period_start ? new Date(inv.period_start * 1000).toISOString() : null,
      periodEnd: inv.period_end ? new Date(inv.period_end * 1000).toISOString() : null,
    }));

    return reply.status(200).send({
    invoices: invoiceDtos,
    hasMore: invoices.has_more,
    });
  } catch (error) {
    billingInvoicesLogger.error('Error fetching invoices', error instanceof Error ? error : new Error(String(error)));

    if (error instanceof Error) {
      const errorCode = (error as Error & { code?: string }).code;
      const isStripeError = errorCode?.startsWith('stripe_') ||
                  error.message.includes('Stripe') ||
                  error.name === 'StripeError';
      if (isStripeError) {
        return sendError(reply, 502, ErrorCodes.EXTERNAL_API_ERROR, 'Payment provider error');
      }
    }

    return errors.internal(reply);
  }
  });
}
