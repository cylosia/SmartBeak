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
  startingAfter: z.string().optional(),
});

export type QueryType = z.infer<typeof QuerySchema>;

/**
* JWT claims with optional Stripe customer ID
*/
export interface JwtClaims {
  sub?: string | undefined;
  orgId?: string | undefined;
  stripeCustomerId?: string | undefined;
  [key: string]: unknown;
}

type AuthenticatedRequest = FastifyRequest & {
  user: {
  id?: string | undefined;
  orgId?: string | undefined;
  stripeCustomerId?: string | undefined;
  };
};

export interface InvoiceResponse {
  invoices: Stripe.Invoice[];
  hasMore: boolean;
}

export interface ErrorResponse {
  error: string;
  code: string;
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

    // P1-FIX: Store full user context including id and orgId for membership verification
    (req as AuthenticatedRequest).user = {
      id: claims.sub,
      orgId: claims.orgId,
      stripeCustomerId: claims.stripeCustomerId
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

  // P1-FIX: Membership verification hook
  // SECURITY AUDIT FIX: Require orgId for billing routes. Previously, requests
  // without orgId skipped the membership check entirely, allowing IDOR via
  // a JWT with stripeCustomerId but no orgId.
  app.addHook('onRequest', async (req, reply) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    const orgId = authReq.user?.orgId;

    // Require both userId and orgId for billing access
    if (!userId) {
      return errors.unauthorized(reply, 'Authentication required');
    }
    if (!orgId) {
      return errors.forbidden(reply, 'Organization context required for billing access');
    }

    // Verify user is a member of the organization
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
    const customerId = authReq.user?.stripeCustomerId;
    if (!customerId) {
      return errors.unauthorized(reply);
    }

    const invoices = await stripe.invoices.list({
    customer: customerId,
    limit,
    starting_after: startingAfter ?? undefined,
    } as Stripe.InvoiceListParams);

    return reply.status(200).send({
    invoices: invoices.data,
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
