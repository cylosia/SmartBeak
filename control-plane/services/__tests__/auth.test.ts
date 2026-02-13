/**
 * P0 TEST: Control-Plane Auth Service Tests
 *
 * Tests authFromHeader, requireRole, requireOrgAccess, requireAccess,
 * hasRole, hasOrgAccess, and all error classes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  authFromHeader,
  requireRole,
  requireOrgAccess,
  requireAccess,
  hasRole,
  hasOrgAccess,
  AuthError,
  AuthorizationHeaderError,
  InvalidTokenError,
  TokenExpiredError,
  TokenRevokedError,
  MissingClaimsError,
  ForbiddenError,
  OrganizationAccessError,
  RoleAccessError,
} from '../auth';
import type { AuthContext, Role } from '../auth';

// Mock JWT verification
vi.mock('../jwt', () => ({
  verifyToken: vi.fn(),
}));

// Mock kernel auth errors
vi.mock('@kernel/auth', () => ({
  TokenExpiredError: class TokenExpiredError extends Error {
    constructor(msg: string) { super(msg); this.name = 'TokenExpiredError'; }
  },
  TokenRevokedError: class TokenRevokedError extends Error {
    constructor(msg: string) { super(msg); this.name = 'TokenRevokedError'; }
  },
}));

import { verifyToken } from '../jwt';
import { TokenExpiredError as KernelTokenExpiredError, TokenRevokedError as KernelTokenRevokedError } from '@kernel/auth';

const mockVerifyToken = verifyToken as ReturnType<typeof vi.fn>;

describe('Control-Plane Auth Service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================================================
  // authFromHeader
  // ============================================================================

  describe('authFromHeader', () => {
    it('should extract auth context from valid token', async () => {
      mockVerifyToken.mockResolvedValue({
        sub: 'user-123',
        orgId: 'org-456',
        role: 'admin',
      });

      const ctx = await authFromHeader('Bearer valid-token-here');
      expect(ctx.userId).toBe('user-123');
      expect(ctx.orgId).toBe('org-456');
      expect(ctx.roles).toEqual(['admin']);
    });

    it('should throw AuthorizationHeaderError for missing header', async () => {
      await expect(authFromHeader(undefined)).rejects.toThrow(AuthorizationHeaderError);
    });

    it('should throw AuthorizationHeaderError for non-Bearer format', async () => {
      await expect(authFromHeader('Basic dXNlcjpwYXNz')).rejects.toThrow(AuthorizationHeaderError);
    });

    it('should throw InvalidTokenError for too-short token', async () => {
      await expect(authFromHeader('Bearer short')).rejects.toThrow(InvalidTokenError);
    });

    it('should throw TokenExpiredError when kernel throws TokenExpiredError', async () => {
      mockVerifyToken.mockRejectedValue(new KernelTokenExpiredError('expired'));
      await expect(authFromHeader('Bearer a-valid-length-token')).rejects.toThrow(TokenExpiredError);
    });

    it('should throw TokenRevokedError when kernel throws TokenRevokedError', async () => {
      mockVerifyToken.mockRejectedValue(new KernelTokenRevokedError('revoked'));
      await expect(authFromHeader('Bearer a-valid-length-token')).rejects.toThrow(TokenRevokedError);
    });

    it('should throw InvalidTokenError for generic verification failure', async () => {
      mockVerifyToken.mockRejectedValue(new Error('bad signature'));
      await expect(authFromHeader('Bearer a-valid-length-token')).rejects.toThrow(InvalidTokenError);
    });

    it('should throw MissingClaimsError for missing sub', async () => {
      mockVerifyToken.mockResolvedValue({ orgId: 'org-1', role: 'admin' });
      await expect(authFromHeader('Bearer a-valid-length-token')).rejects.toThrow(MissingClaimsError);
    });

    it('should throw MissingClaimsError for missing orgId', async () => {
      mockVerifyToken.mockResolvedValue({ sub: 'user-1', role: 'admin' });
      await expect(authFromHeader('Bearer a-valid-length-token')).rejects.toThrow(MissingClaimsError);
    });

    it('should throw MissingClaimsError for missing role', async () => {
      mockVerifyToken.mockResolvedValue({ sub: 'user-1', orgId: 'org-1' });
      await expect(authFromHeader('Bearer a-valid-length-token')).rejects.toThrow(MissingClaimsError);
    });
  });

  // ============================================================================
  // requireRole
  // ============================================================================

  describe('requireRole', () => {
    const adminCtx: AuthContext = { userId: 'u1', orgId: 'o1', roles: ['admin'] };
    const viewerCtx: AuthContext = { userId: 'u2', orgId: 'o1', roles: ['viewer'] };
    const multiCtx: AuthContext = { userId: 'u3', orgId: 'o1', roles: ['editor', 'viewer'] };

    it('should pass when user has required role', () => {
      expect(() => requireRole(adminCtx, ['admin'])).not.toThrow();
    });

    it('should pass when user has one of allowed roles', () => {
      expect(() => requireRole(multiCtx, ['admin', 'editor'])).not.toThrow();
    });

    it('should throw RoleAccessError when user lacks role', () => {
      expect(() => requireRole(viewerCtx, ['admin', 'editor'])).toThrow(RoleAccessError);
    });

    it('should throw with descriptive message', () => {
      try {
        requireRole(viewerCtx, ['admin']);
      } catch (e) {
        expect((e as Error).message).toContain('Required role: admin');
        expect((e as Error).message).toContain('viewer');
      }
    });
  });

  // ============================================================================
  // requireOrgAccess
  // ============================================================================

  describe('requireOrgAccess', () => {
    const ctx: AuthContext = { userId: 'u1', orgId: 'org-1', roles: ['admin'] };

    it('should pass when org matches', () => {
      expect(() => requireOrgAccess(ctx, 'org-1')).not.toThrow();
    });

    it('should throw OrganizationAccessError when org does not match', () => {
      expect(() => requireOrgAccess(ctx, 'org-2')).toThrow(OrganizationAccessError);
    });
  });

  // ============================================================================
  // requireAccess (combined check)
  // ============================================================================

  describe('requireAccess', () => {
    const ctx: AuthContext = { userId: 'u1', orgId: 'org-1', roles: ['admin'] };

    it('should pass when both org and role match', () => {
      expect(() => requireAccess(ctx, 'org-1', ['admin'])).not.toThrow();
    });

    it('should throw OrganizationAccessError for wrong org', () => {
      expect(() => requireAccess(ctx, 'org-2', ['admin'])).toThrow(OrganizationAccessError);
    });

    it('should throw RoleAccessError for wrong role', () => {
      expect(() => requireAccess(ctx, 'org-1', ['owner'])).toThrow(RoleAccessError);
    });
  });

  // ============================================================================
  // hasRole / hasOrgAccess (boolean versions)
  // ============================================================================

  describe('hasRole', () => {
    it('should return true when user has one of allowed roles', () => {
      const ctx: AuthContext = { userId: 'u1', orgId: 'o1', roles: ['editor'] };
      expect(hasRole(ctx, ['editor', 'admin'])).toBe(true);
    });

    it('should return false when user lacks all roles', () => {
      const ctx: AuthContext = { userId: 'u1', orgId: 'o1', roles: ['viewer'] };
      expect(hasRole(ctx, ['editor', 'admin'])).toBe(false);
    });
  });

  describe('hasOrgAccess', () => {
    it('should return true for matching org', () => {
      const ctx: AuthContext = { userId: 'u1', orgId: 'org-1', roles: ['admin'] };
      expect(hasOrgAccess(ctx, 'org-1')).toBe(true);
    });

    it('should return false for different org', () => {
      const ctx: AuthContext = { userId: 'u1', orgId: 'org-1', roles: ['admin'] };
      expect(hasOrgAccess(ctx, 'org-2')).toBe(false);
    });
  });

  // ============================================================================
  // Error Classes
  // ============================================================================

  describe('Error Classes', () => {
    it('AuthError should have code and statusCode', () => {
      const err = new AuthError('test', 'TEST_CODE', 401);
      expect(err.code).toBe('TEST_CODE');
      expect(err.statusCode).toBe(401);
      expect(err.name).toBe('AuthError');
      expect(err).toBeInstanceOf(Error);
    });

    it('AuthorizationHeaderError defaults to 401', () => {
      const err = new AuthorizationHeaderError();
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('AUTHORIZATION_HEADER_MISSING');
    });

    it('InvalidTokenError defaults to 401', () => {
      const err = new InvalidTokenError();
      expect(err.statusCode).toBe(401);
    });

    it('TokenExpiredError defaults to 401', () => {
      const err = new TokenExpiredError();
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe('TOKEN_EXPIRED');
    });

    it('TokenRevokedError defaults to 401', () => {
      const err = new TokenRevokedError();
      expect(err.code).toBe('TOKEN_REVOKED');
    });

    it('MissingClaimsError includes claim name', () => {
      const err = new MissingClaimsError('sub');
      expect(err.message).toContain('sub');
    });

    it('ForbiddenError defaults to 403', () => {
      const err = new ForbiddenError();
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe('FORBIDDEN');
    });

    it('OrganizationAccessError defaults to 403', () => {
      const err = new OrganizationAccessError();
      expect(err.statusCode).toBe(403);
    });

    it('RoleAccessError includes required and current roles', () => {
      const err = new RoleAccessError(['admin', 'owner'], ['viewer']);
      expect(err.message).toContain('admin or owner');
      expect(err.message).toContain('viewer');
      expect(err.statusCode).toBe(403);
    });
  });
});
