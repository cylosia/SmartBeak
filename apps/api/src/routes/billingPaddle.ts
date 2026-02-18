
// Using 'as const' for type safety

// SECURITY FIX: P1-HIGH Issue 3 - Strict rate limiting for billing

import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { createPaddleCheckout } from '../billing/paddle';
import { extractAndVerifyToken } from '@security/jwt';
import { rateLimitMiddleware } from '../middleware/rateLimiter';
import { getLogger } from '@kernel/logger';
import { getDb } from '../db';
import { errors, sendError } from '@errors/responses';
import { ErrorCodes } from '@errors';

const billingPaddleLogger = getLogger('billingPaddle');

const ALLOWED_PADDLE_FIELDS = ['planId'] as const;
const ALLOWED_PLAN_ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;

// P2-FIX: Import shared whitelistFields — previously duplicated verbatim here
// and in billingStripe.ts. Single canonical source prevents divergence.
import { whitelistFields } from '../utils/validation';

export interface CheckoutBody {
  planId?: unknown;
}

export interface CheckoutRouteParams {
  Body: CheckoutBody;
}

function validatePlanId(planId: string): boolean {
  return ALLOWED_PLAN_ID_PATTERN.test(planId);
}

/**

* Additional validation beyond basic schema
*/
const CheckoutBodySchema = z.object({
  planId: z.string().min(1).max(100).regex(
    /^[a-zA-Z0-9_-]+$/,
    'planId must contain only alphanumeric characters, underscores, and hyphens'
  ),
}).strict();

type AuthenticatedRequest = FastifyRequest & {
  user: {
  id?: string | undefined;
  orgId: string;
  stripeCustomerId?: string | undefined;
  };
};

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

export async function billingPaddleRoutes(app: FastifyInstance): Promise<void> {
  // SECURITY FIX: P1-HIGH Issue 3 - Strict rate limiting for billing (5 req/min)
  app.addHook('onRequest', rateLimitMiddleware('strict', undefined, { detectBots: true }));

  // SECURITY FIX: Use centralized JWT verification
  app.addHook('onRequest', async (req, reply) => {
    const authHeader = req.headers.authorization;
    const result = extractAndVerifyToken(authHeader);

    if (!result.valid || !result.claims?.orgId) {
    return errors.unauthorized(reply, result.error || 'Unauthorized');
    }

    // P1-FIX: Store full user context including id for membership verification
    (req as AuthenticatedRequest).user = { 
      id: result.claims.sub,
      orgId: result.claims.orgId 
    };
  });

  // P1-FIX: Add membership verification hook
  app.addHook('onRequest', async (req, reply) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.id;
    const orgId = authReq.user?.orgId;
    
    if (!userId || !orgId) {
      return errors.unauthorized(reply);
    }

    // Verify user is a member of the organization
    const hasMembership = await verifyOrgMembership(userId, orgId);
    if (!hasMembership) {
      return errors.forbidden(reply, 'Organization membership required');
    }
  });

  app.post<CheckoutRouteParams & {
    Reply: { url?: string | null; error?: string; code?: string };
  }>('/billing/paddle/checkout', async (
    req,
    reply
  ): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    try {
        const whitelistedBody = whitelistFields(
        (req.body || {}) as Record<string, unknown>,
        ALLOWED_PADDLE_FIELDS
        );

    const parseResult = CheckoutBodySchema.safeParse(whitelistedBody);
    if (!parseResult.success) {
        return errors.validationFailed(reply, parseResult.error.issues);
    }

    const { planId } = parseResult.data;

    if (!validatePlanId(planId)) {
        return errors.badRequest(reply, 'Invalid planId format');
    }

    const orgId = authReq.user?.orgId;
    if (!orgId) {
      return errors.unauthorized(reply);
    }

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(orgId)) {
        return errors.badRequest(reply, 'Invalid organization ID', ErrorCodes.INVALID_UUID);
    }

    // P1-FIX: Removed the db.transaction() wrapper. createPaddleCheckout is a
    // Paddle HTTP API call — it never used the transaction client (_trx was unused
    // and prefixed with _ to signal that). The wrapper added transaction overhead
    // for zero benefit: no DB writes occurred inside it, and a rolled-back
    // transaction around a Paddle call cannot undo the external side-effect.
    const session = await createPaddleCheckout(orgId, planId);
    if (!session['url']) {
      return reply.status(502).send({ error: 'Payment provider unavailable', code: 'PROVIDER_ERROR' });
    }
    return reply.status(200).send(session);
    } catch (error) {
    billingPaddleLogger.error('Error in paddle checkout', error instanceof Error ? error : new Error(String(error)));
    // SECURITY FIX: P1-HIGH Issue 2 - Sanitize error messages
    // Categorized error handling with error code checking
    if (error instanceof Error) {
        const errorCode = (error as Error & { code?: string }).code;
        const isPaddleError = errorCode?.startsWith('paddle_') ||
                    error["message"].includes('Paddle') ||
                    error.name === 'PaddleError';
        if (isPaddleError) {
        return sendError(reply, 502, ErrorCodes.EXTERNAL_API_ERROR, 'Payment provider error');
        }
    }

    return errors.internal(reply);
    }
  });
}
