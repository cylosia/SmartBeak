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
  return Array.from({ length: count }, (_, index) =>
    createUser({
      ...options,
      email: options.email || `user${index}@example.com`,
    })
  );
}
