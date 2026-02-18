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
  settings?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  createdAt?: Date;
  // P2-P3: Allow creating soft-deleted orgs for testing deletion/cascade behaviour
  deletedAt?: Date | null;
}

export function createOrganization(options: OrgFactoryOptions = {}) {
  const randomSuffix = crypto.randomBytes(4).toString('hex');
  const name = options.name || `Test Organization ${randomSuffix}`;

  // P2-12: Resolve plan default BEFORE computing limits so max_users/max_domains
  // are always derived from the same plan value that ends up in the returned object.
  const plan = options.plan ?? 'free';

  const slug = options.slug || name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  // P3-13: Guarantee created_at < updated_at even when both resolve within the same ms.
  const createdAt = options.createdAt ?? new Date();
  const updatedAt = new Date(createdAt.getTime() + 1);

  return {
    id: options.id || crypto.randomUUID(),
    name,
    slug,
    plan,
    plan_status: options.planStatus || 'active',
    settings: {
      default_timezone: 'UTC',
      default_language: 'en',
      ...options.settings,
    },
    metadata: options.metadata || {},
    created_at: createdAt,
    updated_at: updatedAt,
    // P2-3: Support soft-deleted orgs in test data
    deleted_at: options.deletedAt !== undefined ? options.deletedAt : null,
    max_users: plan === 'enterprise' ? 100 : plan === 'pro' ? 25 : 5,
    max_domains: plan === 'enterprise' ? 50 : plan === 'pro' ? 10 : 2,
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
  role?: 'owner' | 'admin' | 'editor' | 'viewer';
  status?: 'active' | 'inactive' | 'pending';
  invitedAt?: Date;
  joinedAt?: Date;
}

export function createMembership(options: MembershipFactoryOptions = {}) {
  // P3-12: Removed dead _timestamp and _randomSuffix variables — neither was used.

  return {
    id: options.id || crypto.randomUUID(),
    user_id: options.userId || crypto.randomUUID(),
    org_id: options.orgId || crypto.randomUUID(),
    role: options.role || 'editor',
    status: options.status || 'active',
    invited_at: options.invitedAt || new Date(),
    joined_at: options.joinedAt || new Date(),
    updated_at: new Date(),
  };
}
