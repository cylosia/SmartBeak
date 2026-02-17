import { getLogger } from '@kernel/logger';
import { ServiceUnavailableError } from '@errors';

const logger = getLogger('stripe');

export interface CreateCustomerResult {
  customerId: string;
}

export interface CreateSubscriptionResult {
  subscriptionId: string;
}

// C3-FIX: Define PaymentGateway interface so BillingService depends on an
// abstraction, not the concrete stub.  Enables real Stripe wiring in production
// and a controlled stub in development/test without process-crashing top-level
// throw or silent no-ops.
export interface PaymentGateway {
  createCustomer(orgId: string): Promise<CreateCustomerResult>;
  createSubscription(customerId: string, planId: string): Promise<CreateSubscriptionResult>;
  cancelSubscription(subscriptionId: string): Promise<boolean>;
  deleteCustomer(customerId: string): Promise<boolean>;
}

/**
 * Stub implementation for local development and testing.
 * Returns plausible fake IDs; never calls the Stripe API.
 */
export class StubPaymentGateway implements PaymentGateway {
  async createCustomer(orgId: string): Promise<CreateCustomerResult> {
    logger.info('StubPaymentGateway.createCustomer', { orgId });
    return { customerId: `cus_stub_${orgId}` };
  }

  async createSubscription(customerId: string, planId: string): Promise<CreateSubscriptionResult> {
    logger.info('StubPaymentGateway.createSubscription', { customerId, planId });
    return { subscriptionId: `sub_stub_${customerId}_${planId}` };
  }

  async cancelSubscription(subscriptionId: string): Promise<boolean> {
    logger.info('StubPaymentGateway.cancelSubscription', { subscriptionId });
    return true;
  }

  async deleteCustomer(customerId: string): Promise<boolean> {
    logger.info('StubPaymentGateway.deleteCustomer', { customerId });
    return true;
  }
}

/**
 * Real Stripe gateway.  Validates that STRIPE_SECRET_KEY is present at
 * construction time so the missing-key error surfaces at startup, not
 * mid-request. Actual Stripe SDK calls should be added here when the
 * stripe npm package is installed.
 */
export class StripePaymentGateway implements PaymentGateway {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    if (!apiKey) {
      throw new ServiceUnavailableError('STRIPE_SECRET_KEY is not configured');
    }
    this.apiKey = apiKey;
    // Suppress unused-variable lint warning until SDK calls are wired
    void this.apiKey;
  }

  async createCustomer(orgId: string): Promise<CreateCustomerResult> {
    // TODO: replace with real Stripe SDK call when stripe package is available
    // e.g.: const customer = await stripe.customers.create({ metadata: { orgId } });
    logger.warn('StripePaymentGateway.createCustomer: SDK not wired, returning stub', { orgId });
    return { customerId: `cus_${orgId}` };
  }

  async createSubscription(customerId: string, planId: string): Promise<CreateSubscriptionResult> {
    // TODO: replace with real Stripe SDK call
    logger.warn('StripePaymentGateway.createSubscription: SDK not wired, returning stub', { customerId, planId });
    return { subscriptionId: `sub_${customerId}_${planId}` };
  }

  async cancelSubscription(subscriptionId: string): Promise<boolean> {
    // TODO: replace with real Stripe SDK call
    logger.warn('StripePaymentGateway.cancelSubscription: SDK not wired', { subscriptionId });
    return true;
  }

  async deleteCustomer(customerId: string): Promise<boolean> {
    // TODO: replace with real Stripe SDK call
    logger.warn('StripePaymentGateway.deleteCustomer: SDK not wired', { customerId });
    return true;
  }
}

// Factory used by container.ts to pick the right implementation at startup.
export function createPaymentGateway(): PaymentGateway {
  const stripeKey = process.env['STRIPE_SECRET_KEY'];

  if (process.env['NODE_ENV'] === 'production') {
    if (!stripeKey) {
      throw new ServiceUnavailableError('STRIPE_SECRET_KEY is required in production');
    }
    return new StripePaymentGateway(stripeKey);
  }

  if (stripeKey) {
    logger.info('STRIPE_SECRET_KEY present — using StripePaymentGateway');
    return new StripePaymentGateway(stripeKey);
  }

  logger.warn('STRIPE_SECRET_KEY not set — using StubPaymentGateway (non-production only)');
  return new StubPaymentGateway();
}

// Keep backward-compatible export so existing imports of StripeAdapter still compile.
// Alias points to the stub for non-production; production callers must migrate to
// createPaymentGateway() or inject a PaymentGateway directly.
/** @deprecated Use createPaymentGateway() instead */
export const StripeAdapter = StubPaymentGateway;
