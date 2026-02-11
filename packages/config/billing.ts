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

  /** Paddle API key */
  get paddleApiKey(): string {
    return process.env['PADDLE_API_KEY'] || '';
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
