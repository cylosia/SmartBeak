
// Using 'as const' for type safety

// SECURITY FIX: P1-HIGH Issue 3 - Strict rate limiting for billing

import crypto from 'crypto';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { createStripeCheckoutSession } from '../billing/stripe';
import { extractAndVerifyToken } from '@security/jwt';
import { getLogger } from '@kernel/logger';
import { errors } from '@errors/responses';

const billingStripeLogger = getLogger('billingStripe');
import { rateLimitMiddleware } from '../middleware/rateLimiter';
import { getRedis } from '@kernel/redis';
import { getDb } from '../db';

const ALLOWED_STRIPE_FIELDS = ['priceId', 'csrfToken'] as const;
const ALLOWED_PRICE_ID_PATTERN = /^[a-zA-Z0-9_-]{1,100}$/;

// CRITICAL-FIX: Migrated from in-memory Map to Redis-based CSRF storage
// Previous in-memory storage had issues:
// - Lost tokens on server restart
// - Did not work across multiple serverless instances
// - Not suitable for production deployments
// 
// Now using centralized Redis-based CSRF functions from ../middleware/csrf
// with the following keys:
// - csrf:billing:{token} -> {orgId, expires} with TTL

// P1-FIX: Reduced from 1 hour to 15 minutes per OWASP CSRF token lifetime recommendation
const CSRF_TOKEN_EXPIRY_MS = 900000; // 15 minutes
const BILLING_CSRF_PREFIX = 'csrf:billing:';

/**
* Generate a cryptographically secure CSRF token (billing-specific)
* CRITICAL-FIX: Now uses Redis for persistent storage
*/
async function generateBillingCsrfToken(orgId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex');
  const redis = await getRedis();
  const key = `${BILLING_CSRF_PREFIX}${token}`;
  
  // Store in Redis with TTL for automatic expiration
  await redis.setex(key, CSRF_TOKEN_EXPIRY_MS / 1000, JSON.stringify({
    orgId,
    created: Date.now()
  }));
  
  return token;
}


/**
* Validate CSRF token for org
* CRITICAL-FIX: Atomic get-validate-delete via Lua script to prevent race conditions.
* Without atomicity, two concurrent requests can both validate the same token.
*/
async function validateBillingCsrfToken(token: string, orgId: string): Promise<boolean> {
  const redis = await getRedis();
  const key = `${BILLING_CSRF_PREFIX}${token}`;

  // Atomic get-validate-delete: returns 1 if valid (and deletes), 0 otherwise
  const luaScript = `
    local data = redis.call('GET', KEYS[1])
    if not data then return 0 end
    local ok, record = pcall(cjson.decode, data)
    if not ok then return 0 end
    if record.orgId ~= ARGV[1] then return 0 end
    redis.call('DEL', KEYS[1])
    return 1
  `;

  try {
    const result = await redis.eval(luaScript, 1, key, orgId);
    return result === 1;
  } catch {
    return false;
  }
}

type AuthenticatedRequest = FastifyRequest & {
  user: {
  id?: string | undefined;
  orgId: string;
  stripeCustomerId?: string | undefined;
  };
};

// P2-FIX: Import shared whitelistFields — previously duplicated verbatim in
// both billingStripe.ts and billingPaddle.ts, creating a divergence risk.
import { whitelistFields } from '../utils/validation';

export interface CheckoutBody {
  priceId?: unknown;
  csrfToken?: unknown;
}

export interface CheckoutRouteParams {
  Body: CheckoutBody;
}

// P3-FIX: Removed _validatePriceId — dead code; the CheckoutBodySchema regex
// below performs identical validation via Zod and is the only call site.

/**
* Request body schema with strict mode to reject unknown fields
*/
const CheckoutBodySchema = z.object({
  priceId: z.string().min(1).max(100).regex(
    /^[a-zA-Z0-9_-]+$/,
    'priceId must contain only alphanumeric characters, underscores, and hyphens'
  ),
  csrfToken: z.string().min(64).max(64), // CSRF token is 64 hex chars
}).strict();

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

export async function billingStripeRoutes(app: FastifyInstance): Promise<void> {
  // SECURITY FIX: P1-HIGH Issue 3 - Strict rate limiting for billing (5 req/min)
  app.addHook('onRequest', rateLimitMiddleware('strict', undefined, { detectBots: true }));

  // SECURITY FIX: Use centralized JWT verification
  app.addHook('onRequest', async (req, reply) => {
    const authHeader = req.headers.authorization;
    const result = extractAndVerifyToken(authHeader);

    if (!result.valid || !result.claims?.orgId) {
    return errors.unauthorized(reply, result.error || 'Authentication required');
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
      return errors.forbidden(reply, 'Forbidden');
    }
  });

  // SECURITY FIX: Issue 13 - CSRF token endpoint
  // CRITICAL-FIX: Now returns Promise-based token generation with Redis storage
  app.get('/billing/stripe/csrf-token', async (req, reply) => {
    const authReq = req as AuthenticatedRequest;
    const orgId = authReq.user?.orgId;
    if (!orgId) {
      return errors.unauthorized(reply);
    }

    const token = await generateBillingCsrfToken(orgId);

    return reply.send({ csrfToken: token });
  });

  app.post<CheckoutRouteParams & {
    Reply: { url?: string | null; error?: string; code?: string };
  }>('/billing/stripe/checkout', async (
    req,
    reply
  ): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    try {
        const whitelistedBody = whitelistFields(
        (req.body || {}) as Record<string, unknown>,
        ALLOWED_STRIPE_FIELDS
        );

    const parseResult = CheckoutBodySchema.safeParse(whitelistedBody);
    if (!parseResult.success) {
        return errors.badRequest(reply, 'Invalid input');
    }

    const { priceId, csrfToken } = parseResult.data;

    const orgId = authReq.user?.orgId;
    if (!orgId) {
      return errors.unauthorized(reply);
    }

    // P2-FIX: Validate orgId format BEFORE using it in the CSRF token lookup.
    // Previously the UUID check came after validateBillingCsrfToken(), meaning
    // a malformed orgId was passed into the Redis key construction first.
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(orgId)) {
        return errors.badRequest(reply, 'Invalid organization ID');
    }

    const isValidCsrf = await validateBillingCsrfToken(csrfToken, orgId);
    if (!isValidCsrf) {
        return errors.forbidden(reply, 'Invalid or expired CSRF token');
    }

    const session = await createStripeCheckoutSession(orgId, priceId);
    if (!session["url"]) {
        return reply.status(500).send({
        error: 'Failed to create checkout session',
        code: 'CHECKOUT_ERROR'
        });
    }
    return reply.send({ url: session["url"] });
    } catch (error) {
    billingStripeLogger.error('Error in stripe checkout', error instanceof Error ? error : new Error(String(error)));
    // SECURITY FIX: P1-HIGH Issue 2 - Sanitize error messages
    // Categorized error handling with error code checking
    if (error instanceof Error) {
        const errorCode = (error as Error & { code?: string }).code;
        const isStripeError = errorCode?.startsWith('stripe_') ||
                    error["message"].includes('Stripe') ||
                    error.name === 'StripeError';
        if (isStripeError) {
        return reply.status(502).send({
            error: 'Payment provider error',
            code: 'PROVIDER_ERROR'
        });
        }
    }

    return reply.status(500).send({
        error: 'Internal server error',
        code: 'INTERNAL_ERROR',
    });
    }
  });
}
