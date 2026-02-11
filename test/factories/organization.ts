/**
 * Test Factories: Organization
 * 
 * Provides factory functions for creating test organization data.
 */

import crypto from 'crypto';

export interface OrgFactoryOptions {
  id?: string;
  name?: string;
  slug?: string;
  plan?: 'free' | 'pro' | 'enterprise';
  planStatus?: 'active' | 'cancelled' | 'past_due';
  settings?: Record<string, any>;
  metadata?: Record<string, any>;
  createdAt?: Date;
}

export function createOrganization(options: OrgFactoryOptions = {}) {
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const name = options.name || `Test Organization ${randomSuffix}`;

  return {
    id: options.id || `org-${timestamp}-${randomSuffix}`,
    name,
    slug: options.slug || name.toLowerCase().replace(/\s+/g, '-'),
    plan: options.plan || 'free',
    plan_status: options.planStatus || 'active',
    settings: {
      default_timezone: 'UTC',
      default_language: 'en',
      ...options.settings,
    },
    metadata: options.metadata || {},
    created_at: options.createdAt || new Date(),
    updated_at: new Date(),
    deleted_at: null,
    max_users: options.plan === 'enterprise' ? 100 : options.plan === 'pro' ? 25 : 5,
    max_domains: options.plan === 'enterprise' ? 50 : options.plan === 'pro' ? 10 : 2,
  };
}

export function createProOrganization(options: Omit<OrgFactoryOptions, 'plan'> = {}) {
  return createOrganization({ ...options, plan: 'pro' });
}

export function createEnterpriseOrganization(
  options: Omit<OrgFactoryOptions, 'plan'> = {}
) {
  return createOrganization({ ...options, plan: 'enterprise' });
}

export interface MembershipFactoryOptions {
  id?: string;
  userId?: string;
  orgId?: string;
  role?: 'owner' | 'admin' | 'member';
  status?: 'active' | 'inactive' | 'pending';
  invitedAt?: Date;
  joinedAt?: Date;
}

export function createMembership(options: MembershipFactoryOptions = {}) {
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString('hex');

  return {
    id: options.id || `mem-${timestamp}-${randomSuffix}`,
    user_id: options.userId || `user-${randomSuffix}`,
    org_id: options.orgId || `org-${randomSuffix}`,
    role: options.role || 'member',
    status: options.status || 'active',
    invited_at: options.invitedAt || new Date(),
    joined_at: options.joinedAt || new Date(),
    updated_at: new Date(),
  };
}
