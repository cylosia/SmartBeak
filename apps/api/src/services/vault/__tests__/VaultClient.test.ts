/**
 * P0 TEST: VaultClient - Secure Secret Storage Tests
 *
 * Tests secret retrieval, caching, input validation, and error handling.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { VaultClient } from '../VaultClient';

// Mock the logger
vi.mock('@kernel/logger', () => ({
  getLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

describe('VaultClient', () => {
  const validOrgId = '550e8400-e29b-41d4-a716-446655440000';
  const validKey = 'api-key';
  const secretValue = { token: 'secret-123' };

  let store: Record<string, Record<string, unknown>>;
  let client: VaultClient;

  beforeEach(() => {
    store = {
      [`${validOrgId}:${validKey}`]: secretValue,
    };
    client = new VaultClient(store);
  });

  describe('constructor', () => {
    it('should create instance with valid store', () => {
      expect(client).toBeInstanceOf(VaultClient);
    });

    it('should throw on null store', () => {
      expect(() => new VaultClient(null as unknown as Record<string, Record<string, unknown>>)).toThrow('Invalid store');
    });

    it('should throw on non-object store', () => {
      expect(() => new VaultClient('string' as unknown as Record<string, Record<string, unknown>>)).toThrow('Invalid store');
    });
  });

  describe('getSecret', () => {
    it('should retrieve an existing secret', async () => {
      const result = await client.getSecret(validOrgId, validKey);
      expect(result).toEqual(secretValue);
    });

    it('should return cached value on second call', async () => {
      await client.getSecret(validOrgId, validKey);
      // Remove from store to confirm cache is used
      delete store[`${validOrgId}:${validKey}`];
      const result = await client.getSecret(validOrgId, validKey);
      expect(result).toEqual(secretValue);
    });

    it('should throw for non-existent secret', async () => {
      await expect(client.getSecret(validOrgId, 'nonexistent')).rejects.toThrow('Secret not found');
    });

    it('should throw for missing orgId', async () => {
      await expect(client.getSecret('', validKey)).rejects.toThrow('Invalid orgId');
    });

    it('should throw for non-string orgId', async () => {
      await expect(client.getSecret(123 as unknown as string, validKey)).rejects.toThrow('Invalid orgId');
    });

    it('should throw for orgId exceeding max length', async () => {
      const longOrgId = 'a'.repeat(101);
      await expect(client.getSecret(longOrgId, validKey)).rejects.toThrow('exceeds maximum length');
    });

    it('should throw for invalid UUID format orgId', async () => {
      await expect(client.getSecret('not-a-uuid', validKey)).rejects.toThrow('must be a valid UUID');
    });

    it('should throw for missing key', async () => {
      await expect(client.getSecret(validOrgId, '')).rejects.toThrow('Invalid key');
    });

    it('should throw for non-string key', async () => {
      await expect(client.getSecret(validOrgId, 123 as unknown as string)).rejects.toThrow('Invalid key');
    });

    it('should throw for key exceeding max length', async () => {
      const longKey = 'a'.repeat(101);
      await expect(client.getSecret(validOrgId, longKey)).rejects.toThrow('exceeds maximum length');
    });

    it('should throw for key with invalid characters', async () => {
      await expect(client.getSecret(validOrgId, 'invalid key!')).rejects.toThrow('must match pattern');
    });

    it('should accept keys with hyphens and underscores', async () => {
      const keyWithSpecials = 'my-api_key';
      store[`${validOrgId}:${keyWithSpecials}`] = { value: 'test' };
      const result = await client.getSecret(validOrgId, keyWithSpecials);
      expect(result).toEqual({ value: 'test' });
    });
  });

  describe('clearCache', () => {
    it('should clear the cache', async () => {
      await client.getSecret(validOrgId, validKey);
      client.clearCache();
      // After clearing, removing from store should cause not-found
      delete store[`${validOrgId}:${validKey}`];
      await expect(client.getSecret(validOrgId, validKey)).rejects.toThrow('Secret not found');
    });
  });

  describe('getCacheStats', () => {
    it('should return initial empty stats', () => {
      const stats = client.getCacheStats();
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBe(1000);
      expect(stats.ttlMs).toBe(300000);
    });

    it('should reflect cached entries', async () => {
      await client.getSecret(validOrgId, validKey);
      const stats = client.getCacheStats();
      expect(stats.size).toBe(1);
    });
  });
});
