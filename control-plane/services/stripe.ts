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

  // P1-FIX: All methods now throw ServiceUnavailableError instead of logging a warning
  // and returning a fake ID. Previously, if StripePaymentGateway was selected (STRIPE_SECRET_KEY
  // present) but the Stripe SDK calls were not yet wired, the code would silently insert
  // stub IDs like "cus_${orgId}" into the database. Those records look like real Stripe
  // objects but are not, causing silent billing failures and phantom subscriptions.
  // Throwing immediately surfaces the misconfiguration at the earliest possible moment.

  async createCustomer(_orgId: string): Promise<CreateCustomerResult> {
    throw new ServiceUnavailableError('StripePaymentGateway.createCustomer: Stripe SDK integration not yet implemented');
  }

  async createSubscription(_customerId: string, _planId: string): Promise<CreateSubscriptionResult> {
    throw new ServiceUnavailableError('StripePaymentGateway.createSubscription: Stripe SDK integration not yet implemented');
  }

  async cancelSubscription(_subscriptionId: string): Promise<boolean> {
    throw new ServiceUnavailableError('StripePaymentGateway.cancelSubscription: Stripe SDK integration not yet implemented');
  }

  async deleteCustomer(_customerId: string): Promise<boolean> {
    throw new ServiceUnavailableError('StripePaymentGateway.deleteCustomer: Stripe SDK integration not yet implemented');
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

// P1-FIX: Removed deprecated StripeAdapter export. The only consumer (billing.ts) was
// already migrated to PaymentGateway / StubPaymentGateway. The alias pointed to StubPaymentGateway
// which silently returned fake IDs in production — a data-integrity hazard.
