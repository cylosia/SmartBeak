/**
 * CRIT-5 FIX: JWT Algorithm Enforcement on Signing
 *
 * Verifies that signToken() explicitly uses HS256 and includes
 * audience/issuer claims, preventing algorithm confusion attacks.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

// Mock kernel dependencies to break circular logger <-> request-context import
vi.mock('@kernel/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../packages/kernel/logger', () => ({
  getLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('../../../packages/kernel/request-context', () => ({
  getRequestContext: () => undefined,
}));

vi.mock('@kernel/auth', () => ({
  AuthError: class AuthError extends Error {
    code: string;
    constructor(message: string, code?: string) {
      super(message);
      this.name = 'AuthError';
      this.code = code || 'AUTH_ERROR';
    }
  },
}));

// Set env vars BEFORE dynamic import (module-level key validation rejects placeholders)
// AUDIT-FIX P2: Save originals so afterEach can restore them, preventing
// cross-test pollution when this suite runs alongside other JWT tests.
// AUDIT-FIX P3: Module-level save is intentional here — it captures env state before
// this file's mutations. Vitest runs each test file in an isolated worker, so
// cross-file pollution is prevented. The save must be at module level because
// env vars are set at module level (lines 54-57) for the dynamic import to work.
const savedEnv: Record<string, string | undefined> = {
  JWT_KEY_1: process.env['JWT_KEY_1'],
  JWT_KEY_2: process.env['JWT_KEY_2'],
  JWT_AUDIENCE: process.env['JWT_AUDIENCE'],
  JWT_ISSUER: process.env['JWT_ISSUER'],
};
process.env['JWT_KEY_1'] = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4';
process.env['JWT_KEY_2'] = 'f6e5d4c3b2a1f6e5d4c3b2a1f6e5d4c3';
process.env['JWT_AUDIENCE'] = 'smartbeak';
process.env['JWT_ISSUER'] = 'smartbeak-api';

describe('signToken algorithm enforcement', () => {
  // AUDIT-FIX L12: Reset modules between tests to prevent stale module cache.
  // Dynamic imports cache the module after first load; without reset, env var
  // changes between tests have no effect.
  beforeEach(() => {
    vi.resetModules();
  });

  // AUDIT-FIX P2: Restore env vars after all tests to prevent cross-test pollution.
  afterEach(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  it('should sign tokens with explicit HS256 algorithm', async () => {
    const { signToken } = await import('../jwt');

    const token = signToken({
      sub: 'user-123',
      role: 'admin',
      orgId: 'org-456',
    });

    // Decode the header to verify algorithm
    const [headerB64] = token.split('.');
    const header = JSON.parse(Buffer.from(headerB64!, 'base64url').toString());

    expect(header.alg).toBe('HS256');
    expect(header.typ).toBe('JWT');
  });

  it('should include audience and issuer claims in signed tokens', async () => {
    const { signToken } = await import('../jwt');

    const token = signToken({
      sub: 'user-123',
      role: 'admin',
      orgId: 'org-456',
    });

    // Decode without verification to inspect claims
    const decoded = jwt.decode(token) as jwt.JwtPayload;

    expect(decoded.aud).toBe('smartbeak');
    expect(decoded.iss).toBe('smartbeak-api');
  });

  it('should use custom audience and issuer when provided', async () => {
    const { signToken } = await import('../jwt');

    const token = signToken({
      sub: 'user-123',
      role: 'editor',
      orgId: 'org-789',
      aud: 'custom-audience',
      iss: 'custom-issuer',
    });

    const decoded = jwt.decode(token) as jwt.JwtPayload;

    expect(decoded.aud).toBe('custom-audience');
    expect(decoded.iss).toBe('custom-issuer');
  });
});
