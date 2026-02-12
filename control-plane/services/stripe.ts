if (process.env['NODE_ENV'] === 'production') {
  throw new Error('Stripe mock cannot be used in production');
}

export interface CreateCustomerResult {
  customerId: string;
}

export interface CreateSubscriptionResult {
  subscriptionId: string;
}

export class StripeAdapter {
  async createCustomer(orgId: string): Promise<CreateCustomerResult> {
  return { customerId: `cus_${orgId}` };
  }

  async createSubscription(customerId: string, planId: string): Promise<CreateSubscriptionResult> {
  return { subscriptionId: `sub_${customerId}_${planId}` };
  }

  async cancelSubscription(_subscriptionId: string): Promise<boolean> {
  return true;
  }

  async deleteCustomer(_customerId: string): Promise<boolean> {
  return true;
  }
}
