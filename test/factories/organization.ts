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
  // FIX (M13): Use Record<string, unknown> instead of Record<string, any> for type safety
  settings?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
}

export function createOrganization(options: OrgFactoryOptions = {}) {
  const _timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const name = options.name || `Test Organization ${randomSuffix}`;

  return {
    // FIX (M15): Use UUID format to match production (randomUUID generates v4 UUIDs)
    id: options.id || crypto.randomUUID(),
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
  // FIX (M14): Match production role types (owner, admin, editor, viewer) instead of 'member'
  role?: 'owner' | 'admin' | 'editor' | 'viewer';
  status?: 'active' | 'inactive' | 'pending';
  invitedAt?: Date;
  joinedAt?: Date;
}

export function createMembership(options: MembershipFactoryOptions = {}) {
  const _timestamp = Date.now();
  const _randomSuffix = crypto.randomBytes(4).toString('hex');

  return {
    // FIX (M15): Use UUID format to match production
    id: options.id || crypto.randomUUID(),
    user_id: options.userId || crypto.randomUUID(),
    org_id: options.orgId || crypto.randomUUID(),
    // FIX (M14): Default to 'editor' instead of non-existent 'member' role
    role: options.role || 'editor',
    status: options.status || 'active',
    invited_at: options.invitedAt || new Date(),
    joined_at: options.joinedAt || new Date(),
    updated_at: new Date(),
  };
}
