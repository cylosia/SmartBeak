/**
 * Test Factories: User
 * 
 * Provides factory functions for creating test user data.
 */

import crypto from 'crypto';

export interface UserFactoryOptions {
  id?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: 'admin' | 'editor' | 'viewer';
  orgId?: string;
  status?: 'active' | 'inactive' | 'pending';
  createdAt?: Date;
  metadata?: Record<string, unknown>;
}

export function createUser(options: UserFactoryOptions = {}) {
  const timestamp = Date.now();
  const randomSuffix = crypto.randomBytes(4).toString('hex');

  return {
    id: options.id || `user-${timestamp}-${randomSuffix}`,
    email: options.email || `test-${randomSuffix}@example.com`,
    first_name: options.firstName || 'Test',
    last_name: options.lastName || 'User',
    role: options.role || 'viewer',
    org_id: options.orgId || `org-${randomSuffix}`,
    status: options.status || 'active',
    created_at: options.createdAt || new Date(),
    updated_at: new Date(),
    metadata: options.metadata || {},
    email_verified: true,
    last_login_at: new Date(),
  };
}

export function createAdminUser(options: Omit<UserFactoryOptions, 'role'> = {}) {
  return createUser({ ...options, role: 'admin' });
}

export function createEditorUser(options: Omit<UserFactoryOptions, 'role'> = {}) {
  return createUser({ ...options, role: 'editor' });
}

export function createViewerUser(options: Omit<UserFactoryOptions, 'role'> = {}) {
  return createUser({ ...options, role: 'viewer' });
}

export function createUserList(count: number, options: UserFactoryOptions = {}) {
  return Array.from({ length: count }, (_, index) => {
    // When a base email is provided, append a sub-address (+index) to each
    // entry so every user gets a unique email that satisfies DB unique constraints.
    // Without this, all users share the same email and integration tests fail.
    let email: string;
    if (options.email) {
      // P2-FIX: Guard against emails missing '@'. Array destructuring under
      // noUncheckedIndexedAccess types both elements as `string | undefined`,
      // so a missing '@' would silently produce addresses like "user+0@undefined"
      // that fail DB unique constraints in integration tests.
      const atIndex = options.email.indexOf('@');
      if (atIndex < 1) throw new Error(`createUserList: base email '${options.email}' has no '@'`);
      const local = options.email.slice(0, atIndex);
      const domain = options.email.slice(atIndex + 1);
      email = `${local}+${index}@${domain}`;
    } else {
      email = `user${index}@example.com`;
    }
    return createUser({ ...options, email });
  });
}
