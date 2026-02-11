/**
 * Test Factories: Webhook Events
 * 
 * Provides factory functions for creating test webhook events.
 */

import crypto from 'crypto';

export interface PaddleEventFactoryOptions {
  eventType?: string;
  eventId?: string;
  orgId?: string;
  subscriptionId?: string;
  customerEmail?: string;
  payload?: Record<string, any>;
}

export function createPaddleSubscriptionCreatedEvent(
  options: PaddleEventFactoryOptions = {}
) {
  const timestamp = new Date().toISOString();
  
  return {
    event_id: options.eventId || `evt-${Date.now()}`,
    event_type: options.eventType || 'subscription.created',
    occurred_at: timestamp,
    org_id: options.orgId || `org-${crypto.randomBytes(4).toString('hex')}`,
    subscription_id: options.subscriptionId || `sub-${crypto.randomBytes(8).toString('hex')}`,
    customer: {
      id: `cus-${crypto.randomBytes(8).toString('hex')}`,
      email: options.customerEmail || `customer-${Date.now()}@example.com`,
    },
    items: [
      {
        price_id: 'pri_pro_monthly',
        quantity: 1,
      },
    ],
    ...options.payload,
  };
}

export function createPaddleSubscriptionCancelledEvent(
  options: PaddleEventFactoryOptions = {}
) {
  return {
    ...createPaddleSubscriptionCreatedEvent(options),
    event_type: 'subscription.cancelled',
    cancellation_effective_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export function createPaddleTransactionCompletedEvent(
  options: PaddleEventFactoryOptions = {}
) {
  return {
    event_id: options.eventId || `evt-${Date.now()}`,
    event_type: 'transaction.completed',
    occurred_at: new Date().toISOString(),
    org_id: options.orgId || `org-${crypto.randomBytes(4).toString('hex')}`,
    transaction_id: `txn-${crypto.randomBytes(8).toString('hex')}`,
    amount: '99.00',
    currency: 'USD',
    status: 'completed',
    ...options.payload,
  };
}

export interface ClerkEventFactoryOptions {
  type?: string;
  userId?: string;
  orgId?: string;
  email?: string;
  data?: Record<string, any>;
}

export function createClerkUserCreatedEvent(options: ClerkEventFactoryOptions = {}) {
  const userId = options.userId || `user_${crypto.randomBytes(8).toString('hex')}`;
  
  return {
    data: {
      id: userId,
      email_addresses: [
        {
          id: `idn_${crypto.randomBytes(8).toString('hex')}`,
          email_address: options.email || `user-${Date.now()}@example.com`,
          verification: {
            status: 'verified',
            strategy: 'email_code',
          },
        },
      ],
      first_name: 'Test',
      last_name: 'User',
      public_metadata: {},
      ...options.data,
    },
    object: 'event',
    type: options.type || 'user.created',
  };
}

export function createClerkUserUpdatedEvent(options: ClerkEventFactoryOptions = {}) {
  return {
    ...createClerkUserCreatedEvent(options),
    type: 'user.updated',
  };
}

export function createClerkUserDeletedEvent(options: ClerkEventFactoryOptions = {}) {
  return {
    data: {
      id: options.userId || `user_${crypto.randomBytes(8).toString('hex')}`,
      deleted: true,
    },
    object: 'event',
    type: 'user.deleted',
  };
}

export function createClerkOrganizationMembershipCreatedEvent(
  options: ClerkEventFactoryOptions = {}
) {
  return {
    data: {
      id: `orgmem_${crypto.randomBytes(8).toString('hex')}`,
      organization: {
        id: options.orgId || `org_${crypto.randomBytes(8).toString('hex')}`,
        name: 'Test Organization',
      },
      public_user_data: {
        user_id: options.userId || `user_${crypto.randomBytes(8).toString('hex')}`,
      },
      role: 'org:member',
    },
    object: 'event',
    type: 'organizationMembership.created',
  };
}

export function createSvixHeaders(
  payload: object,
  secret: string,
  messageId?: string
): { 'svix-id': string; 'svix-timestamp': string; 'svix-signature': string } {
  const id = messageId || `msg_${crypto.randomBytes(8).toString('hex')}`;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payloadString = JSON.stringify(payload);
  
  const signedContent = `${id}.${timestamp}.${payloadString}`;
  const secretBytes = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice(6), 'base64')
    : Buffer.from(secret, 'base64');
  
  const signature = crypto
    .createHmac('sha256', secretBytes)
    .update(signedContent)
    .digest('base64');

  return {
    'svix-id': id,
    'svix-timestamp': timestamp,
    'svix-signature': `v1,${signature}`,
  };
}
