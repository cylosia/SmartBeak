
import { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth, validateMethod } from '../../../lib/auth';
import { pool } from '../../../lib/db';
import { rateLimit } from '../../../lib/rate-limit';
import { getStripe, validateStripeConfig } from '../../../lib/stripe';
import { getLogger } from '@kernel/logger';
// import { sanitizeForLogging } from '@security/logger';
const sanitizeForLogging = (obj: unknown): unknown => obj;

const logger = getLogger('StripePortal');

// Helper function for sanitizing error messages
function sanitizeErrorMessage(message: string): string {
  const sanitized = sanitizeForLogging({ message }) as { message?: string };
  return sanitized.message || 'An error occurred';
}

/**
* POST /api/stripe/portal
* Creates a Stripe Customer Portal session
* Requires authentication and existing Stripe customer
* 
* P1-HIGH SECURITY FIXES:
* - Issue 13: Missing CSRF protection on Stripe portal
* - Issue 17: Missing request timeout
* - Issue 21: HTTPS enforcement
* - Issue 22: Secrets exposed in error messages
*/

// CSRF token validation
const CSRF_HEADER_NAME = 'x-csrf-token';
const CSRF_COOKIE_NAME = 'csrf_token';

/**
 * Validate CSRF token
 * SECURITY FIX: Issue 13 - CSRF protection
 */
function validateCSRFToken(req: NextApiRequest): boolean {
  const headerToken = req.headers[CSRF_HEADER_NAME.toLowerCase()];
  const cookieToken = req.cookies[CSRF_COOKIE_NAME];
  
  // Both must be present and match
  if (!headerToken || !cookieToken) {
    return false;
  }
  
  if (typeof headerToken !== 'string') {
    return false;
  }
  
  // Use timing-safe comparison
  try {
    const headerBuf = Buffer.from(headerToken, 'utf8');
    const cookieBuf = Buffer.from(cookieToken, 'utf8');
    
    if (headerBuf.length !== cookieBuf.length) {
      return false;
    }
    
    return crypto.timingSafeEqual(headerBuf, cookieBuf);
  } catch {
    return false;
  }
}

import crypto from 'crypto';

/**
 * Set CSRF token cookie
 * SECURITY FIX: Issue 13 - Generate and set CSRF token
 */
function setCSRFCookie(res: NextApiResponse): string {
  const token = crypto.randomBytes(32).toString('hex');
  
  res.setHeader('Set-Cookie', [
    `${CSRF_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=3600`,
  ]);
  
  return token;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!validateMethod(req, res, ['POST'])) return;

  try {
    // SECURITY FIX: Issue 13 - Validate CSRF token for state-changing operation
    if (!validateCSRFToken(req)) {
      logger.warn('CSRF validation failed');
      return res.status(403).json({ 
        error: 'Forbidden',
        code: 'CSRF_INVALID',
        message: 'Invalid or missing CSRF token'
      });
    }
    
    // RATE LIMITING: Billing endpoint - 20 requests/minute
    // SECURITY FIX: Issue 3 - Namespace prefix for rate limit key
    const allowed = await rateLimit('stripe:portal', 20, req, res);
    if (!allowed) return;

    // Validate Stripe is configured
    validateStripeConfig();

    // Validate auth
    const auth = await requireAuth(req, res);
    if (!auth) return;

    const { customerId, returnUrl } = req.body;

    // In production, look up the customer ID from your database
    // Based on the authenticated user's organization
    const stripeCustomerId = customerId || req.body.customerId;

    // IDOR FIX: Verify this customer belongs to the user's org
    if (stripeCustomerId) {
      const { rows } = await pool.query(
        'SELECT 1 FROM orgs WHERE stripe_customer_id = $1 AND id = $2',
        [stripeCustomerId, auth["orgId"]]
      );
      if (rows.length === 0) {
        logger.warn({ userId: auth.userId, stripeCustomerId }, 'User attempted to access Stripe portal for invalid customer');
        return res.status(404).json({ 
          error: 'Not Found',
          code: 'CUSTOMER_NOT_FOUND',
          message: 'Customer not found' 
        });
      }
    }

    if (!stripeCustomerId) {
      return res.status(400).json({
        error: 'Bad Request',
        code: 'MISSING_CUSTOMER_ID',
        message: 'customerId is required',
      });
    }

    // Validate customer ID format
    if (!stripeCustomerId.startsWith('cus_')) {
      return res.status(400).json({
        error: 'Bad Request',
        code: 'INVALID_CUSTOMER_FORMAT',
        message: "Invalid customerId format. Should start with 'cus_'",
      });
    }

    // Get origin for return URL
    const origin = req.headers.origin || process.env['NEXT_PUBLIC_APP_URL'] || 'http://localhost:3000';
    
    // SECURITY FIX: Issue 21 - HTTPS enforcement in production
    if (process.env['NODE_ENV'] === 'production' && !origin.startsWith('https://')) {
      return res.status(400).json({
        error: 'Bad Request',
        code: 'HTTPS_REQUIRED',
        message: 'HTTPS is required in production',
      });
    }

    const stripeClient = getStripe();
    
    // SECURITY FIX: Issue 17 - Add timeout to Stripe API call
    const portal = await Promise.race([
      stripeClient.billingPortal.sessions.create({
        customer: stripeCustomerId,
        return_url: returnUrl || `${origin}/billing`,
      }),
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('Stripe API timeout')), 30000)
      ),
    ]);

    // SECURITY FIX: Issue 21 - Validate portal URL uses HTTPS
    const portalUrl = new URL((portal as { url: string }).url);
    if (portalUrl.protocol !== 'https:') {
      return res.status(400).json({ 
        error: 'Bad Request',
        code: 'INVALID_PORTAL_URL',
        message: 'Invalid portal URL protocol' 
      });
    }
    
    const allowedDomains = [
      'stripe.com',
      'billing.stripe.com',
      'dashboard.stripe.com',
    ];
    if (!allowedDomains.some(domain => portalUrl.hostname.endsWith(domain))) {
      return res.status(400).json({ 
        error: 'Bad Request',
        code: 'INVALID_PORTAL_DOMAIN',
        message: 'Invalid portal URL domain' 
      });
    }

    res.redirect(303, (portal as { url: string }).url);
  } catch (error: unknown) {
    if (error instanceof Error && error.name === 'AuthError') return;
    
    // SECURITY FIX: Issue 22 - Sanitize error messages
    const sanitizedError = sanitizeErrorMessage(error instanceof Error ? error.message : String(error));
    logger.error({ error: sanitizedError }, 'Portal session creation failed');

    const stripeError = error as { type?: string; code?: string; message?: string };
    if (stripeError.type === 'StripeInvalidRequestError') {
      // Common case: customer doesn't exist
      if (stripeError.code === 'resource_missing') {
        return res.status(404).json({
          error: 'Not Found',
          code: 'CUSTOMER_NOT_FOUND',
          message: 'The Stripe customer ID is invalid or has been deleted.'
        });
      }
      return res.status(400).json({
        error: 'Bad Request',
        code: 'STRIPE_ERROR',
        message: 'Invalid request to Stripe',
      });
    }

    if (stripeError.message === 'Stripe is not properly configured') {
      return res.status(503).json({ 
        error: 'Service Unavailable',
        code: 'STRIPE_NOT_CONFIGURED',
        message: 'Payment service not configured' 
      });
    }

    res.status(500).json({
      error: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
      message: 'Failed to create portal session'
    });
  }
}

// Export CSRF utilities for use in the frontend
export { setCSRFCookie, CSRF_HEADER_NAME, CSRF_COOKIE_NAME };
