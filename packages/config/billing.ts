/**
 * Billing Configuration
 * 
 * Payment provider and billing settings.
 */

export const billingConfig = {
  /** Stripe secret key (validated at startup) */
  get stripeSecretKey(): string {
    const key = process.env['STRIPE_SECRET_KEY'];
    if (!key) {
      throw new Error('STRIPE_SECRET_KEY environment variable is required');
    }
    return key;
  },

  /** JWT key for billing authentication */
  get jwtKey(): string {
    const key = process.env['JWT_KEY_1'];
    if (!key) {
      throw new Error('JWT_KEY_1 environment variable is required');
    }
    return key;
  },

  /** Paddle API key (validated at startup) */
  // P1-FIX: Throw on missing key instead of returning empty string
  // (was silently sending empty API key to Paddle, causing confusing auth errors)
  get paddleApiKey(): string {
    const key = process.env['PADDLE_API_KEY'];
    if (!key) {
      throw new Error('PADDLE_API_KEY environment variable is required');
    }
    return key;
  },
} as const;

/**
 * Get billing configuration
 */
export function getBillingConfig(): typeof billingConfig {
  return billingConfig;
}

/**
 * Get Stripe configuration
 */
export function getStripeConfig(): { secretKey: string } {
  return {
    secretKey: billingConfig.stripeSecretKey,
  };
}

/**
 * Assert all billing credentials are present and well-formed at startup.
 * Call this once before the server starts accepting requests so that a
 * misconfigured deployment fails immediately rather than mid-request.
 */
export function assertBillingConfig(): void {
  const stripeKey = process.env['STRIPE_SECRET_KEY'];
  if (!stripeKey) {
    throw new Error('FATAL: STRIPE_SECRET_KEY environment variable is required');
  }
  // P3-FIX: Validate the full Stripe key format, not just the 'sk_' prefix.
  // 'sk_' alone (3 chars) passes the old check. Real keys are:
  //   sk_live_<40+ alphanumeric chars>  or  sk_test_<40+ alphanumeric chars>
  if (!/^sk_(live|test)_[A-Za-z0-9]{40,}$/.test(stripeKey)) {
    throw new Error(
      'FATAL: STRIPE_SECRET_KEY does not match expected Stripe key format ' +
      '(sk_live_... or sk_test_... followed by at least 40 alphanumeric chars)'
    );
  }

  const paddleKey = process.env['PADDLE_API_KEY'];
  if (!paddleKey) {
    throw new Error('FATAL: PADDLE_API_KEY environment variable is required');
  }

  const jwtKey = process.env['JWT_KEY_1'];
  if (!jwtKey) {
    throw new Error('FATAL: JWT_KEY_1 environment variable is required');
  }
}
