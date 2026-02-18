import Stripe from 'stripe';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { verifyToken, extractBearerToken as extractTokenFromHeader, TokenExpiredError, TokenInvalidError, } from '@security/jwt';
import { getLogger } from '@kernel/logger';
import { getBillingConfig } from '@config';
import { getDb } from '../db';
import { verifyOrgMembership } from '../services/membership';
import { errors, sendError } from '@errors/responses';
import { ErrorCodes } from '@errors';
import { rateLimitMiddleware } from '../middleware/rateLimiter';

const billingInvoicesLogger = getLogger('billingInvoices');

// P2-FIX (P2-1): Use config for Stripe credentials and API version so all Stripe
// client instances stay in sync via a single config change (billingInvoiceExport.ts
// already follows this pattern).
const billingConfig = getBillingConfig();
const stripe = new Stripe(billingConfig.stripeSecretKey, {
  apiVersion: billingConfig.stripeApiVersion,
});

// P2-FIX (P2-2): Added .strict() to reject unknown query parameters silently passed
// through (e.g. debug flags, injection probes).
// P2-FIX (P2-3): Relaxed startingAfter to z.string().max(200) — the previous regex
// hard-coded the 'in_' Stripe prefix, breaking pagination for future resource types.
// Stripe's own API validates the cursor format; we only need a length bound.
const QuerySchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(10),
  startingAfter: z.string().max(200).optional(),
}).strict();

export type QueryType = z.infer<typeof QuerySchema>;

// P1-FIX (P1-2): Validate JWT claims with Zod instead of casting to JwtClaims.
// The former JwtClaims interface had an `[key: string]: unknown` index signature,
// meaning any cast to it was trivially satisfied — a JWT with numeric `sub` silently
// set user.id to a number, bypassing downstream string-equality membership checks.
const InvoiceClaimsSchema = z.object({
  sub: z.string().min(1),
  orgId: z.string().min(1),
});

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

export async function billingInvoiceRoutes(app: FastifyInstance): Promise<void> {
  // Rate-limit before auth — mirrors billingStripe/billingPaddle/billingInvoiceExport.
  // Without this an authenticated attacker can exhaust Stripe API quota in a tight loop.
  app.addHook('onRequest', rateLimitMiddleware('standard'));

  app.addHook('onRequest', async (req, reply) => {
  const authHeader = req.headers.authorization;
  const token = extractTokenFromHeader(authHeader);

  if (!token) {
    return errors.unauthorized(reply);
  }

  try {
    const rawClaims = verifyToken(token);
    // P1-FIX (P1-2): Validate claims shape at runtime with Zod instead of unsafe cast.
    const claimsResult = InvoiceClaimsSchema.safeParse(rawClaims);
    if (!claimsResult.success) {
      return errors.unauthorized(reply, 'Invalid token claims');
    }

    (req as AuthenticatedRequest).user = {
      id: claimsResult.data.sub,
      orgId: claimsResult.data.orgId,
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
      // P3-FIX (P3-5): Use consistent message across billing routes.
      return errors.forbidden(reply, 'Organization membership required');
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

    // Use instanceof for reliable Stripe error detection across all SDK subclasses
    // (StripeCardError, StripeInvalidRequestError, etc.). The .name check was dead
    // code: SDK subclasses report their own class name, never the base 'StripeError'.
    if (error instanceof Stripe.errors.StripeError) {
      return sendError(reply, 502, ErrorCodes.EXTERNAL_API_ERROR, 'Payment provider error');
    }

    return errors.internal(reply);
  }
  });
}
