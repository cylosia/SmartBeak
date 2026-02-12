import Stripe from 'stripe';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { verifyToken, extractBearerToken as extractTokenFromHeader, TokenExpiredError, TokenInvalidError, } from '@security/jwt';
import { getDb } from '../db';

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
    return reply.status(401).send({ error: 'Unauthorized', code: 'NO_TOKEN' });
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
    return reply.status(401).send({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    if (error instanceof TokenInvalidError) {
    return reply.status(401).send({ error: 'Invalid token', code: 'INVALID_TOKEN' });
    }
    return reply.status(401).send({ error: 'Authentication failed', code: 'AUTH_FAILED' });
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
      return reply.status(401).send({
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      });
    }
    if (!orgId) {
      return reply.status(403).send({
        error: 'Organization context required for billing access',
        code: 'ORG_CONTEXT_REQUIRED'
      });
    }

    // Verify user is a member of the organization
    const hasMembership = await verifyOrgMembership(userId, orgId);
    if (!hasMembership) {
      return reply.status(403).send({
        error: 'Forbidden',
        code: 'ORG_MEMBERSHIP_REQUIRED'
      });
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
    return reply.status(400).send({
    error: 'Invalid query parameters',
    code: 'VALIDATION_ERROR',
    });
    }

    const { limit: _limit, startingAfter } = queryResult.data;
    const customerId = authReq.user?.stripeCustomerId;
    if (!customerId) {
      return reply.status(401).send({ error: 'Unauthorized', code: 'AUTH_REQUIRED' });
    }

    const invoices = await stripe.invoices.list({
    customer: customerId,
    starting_after: startingAfter ?? undefined,
    } as Stripe.InvoiceListParams);

    return reply.status(200).send({
    invoices: invoices.data,
    hasMore: invoices.has_more,
    });
  } catch (error) {
    console.error('[billing-invoices] Error:', error);

    return reply.status(500).send({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    });
  }
  });
}
