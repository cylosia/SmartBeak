/**
 * Security Tests for Key Rotation System
 * Tests P1 Fix: Weak PBKDF2 salt derivation
 *
 * P2-14: Tests now set env var before each test to work with
 * constructor-time validation (no longer module-level).
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { randomBytes } from 'crypto';
import { KeyRotationManager } from '../keyRotation';
import { Pool } from 'pg';

// Mock logger
jest.mock('@kernel/logger', () => ({
  getLogger: () => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  })
}));

// Mock async-mutex to avoid real mutexes in tests
jest.mock('async-mutex', () => ({
  Mutex: class {
    async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
      return fn();
    }
  }
}));

describe('Key Rotation Security Tests', () => {
  let manager: KeyRotationManager;
  let mockPool: Partial<Pool>;
  let mockQuery: jest.Mock;

  // P2-13: Use cryptographically random secret for tests
  const testSecret = randomBytes(32).toString('hex');

  beforeEach(() => {
    jest.clearAllMocks();

    mockQuery = jest.fn();
    mockPool = {
      query: mockQuery
    };

    // P2-14: Set env var before constructing manager (validated in constructor)
    process.env['KEY_ENCRYPTION_SECRET'] = testSecret;

    manager = new KeyRotationManager(mockPool as Pool);
  });

  describe('P1-FIX: Random Salt Generation', () => {
    it('should generate random salt for each provider', async () => {
      // Mock no existing salt in DB
      mockQuery.mockResolvedValueOnce({ rows: [] }) // No existing salt
               .mockResolvedValueOnce({ rows: [] }) // Insert salt
               .mockResolvedValueOnce({ rows: [] }); // Store key

      // First provider
      await manager.registerKey('provider1', 'key1');

      // Mock different salt for second provider
      mockQuery.mockResolvedValueOnce({ rows: [] }) // No existing salt
               .mockResolvedValueOnce({ rows: [] }) // Insert salt
               .mockResolvedValueOnce({ rows: [] }); // Store key

      await manager.registerKey('provider2', 'key2');

      // Verify salts are stored separately for each provider
      const saltCalls = mockQuery.mock.calls.filter(
        (call: [string, ...unknown[]]) => call[0].includes('provider_key_metadata')
      );
      expect(saltCalls.length).toBeGreaterThanOrEqual(2);
    });

    it('should use different salts for different providers', async () => {
      const storedSalts: Map<string, Buffer> = new Map();

      mockQuery.mockImplementation((query: string, params: unknown[]) => {
        if (query.includes('SELECT salt FROM provider_key_metadata')) {
          const provider = params[0] as string;
          if (storedSalts.has(provider)) {
            return Promise.resolve({ rows: [{ salt: storedSalts.get(provider)!.toString('hex') }] });
          }
          return Promise.resolve({ rows: [] });
        }
        if (query.includes('INSERT INTO provider_key_metadata')) {
          const provider = params[0] as string;
          const salt = params[1] as string;
          storedSalts.set(provider, Buffer.from(salt, 'hex'));
          return Promise.resolve({ rows: [] });
        }
        if (query.includes('INSERT INTO api_keys') || query.includes('UPDATE api_keys')) {
          return Promise.resolve({ rows: [] });
        }
        return Promise.resolve({ rows: [] });
      });

      await manager.registerKey('provider1', 'key1');
      await manager.registerKey('provider2', 'key2');

      const salt1 = storedSalts.get('provider1');
      const salt2 = storedSalts.get('provider2');

      expect(salt1).toBeDefined();
      expect(salt2).toBeDefined();
      expect(salt1!.toString('hex')).not.toBe(salt2!.toString('hex'));
    });

    it('should persist salt in database', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await manager.registerKey('test-provider', 'test-key');

      // Should store salt in provider_key_metadata table
      const metadataCalls = mockQuery.mock.calls.filter(
        (call: [string, ...unknown[]]) =>
          call[0].includes('provider_key_metadata') &&
          call[0].includes('INSERT')
      );
      expect(metadataCalls.length).toBeGreaterThanOrEqual(1);

      // Verify salt parameter is a hex string
      const params = metadataCalls[0][1] as string[];
      expect(params[0]).toBe('test-provider'); // provider name
      expect(params[1]).toMatch(/^[a-f0-9]{64}$/); // 32 bytes = 64 hex chars
    });

    it('should reuse existing salt from database', async () => {
      const existingSalt = 'aabbccdd'.repeat(8); // 64 hex chars = 32 bytes

      mockQuery.mockImplementation((query: string) => {
        if (query.includes('SELECT salt FROM provider_key_metadata')) {
          return Promise.resolve({ rows: [{ salt: existingSalt }] });
        }
        return Promise.resolve({ rows: [] });
      });

      await manager.registerKey('existing-provider', 'test-key');

      // Should use existing salt, not generate new one
      const selectCalls = mockQuery.mock.calls.filter(
        (call: [string, ...unknown[]]) =>
          call[0].includes('SELECT salt FROM provider_key_metadata')
      );
      expect(selectCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('P1-FIX: Salt Security Properties', () => {
    it('should generate 32-byte salts', async () => {
      const capturedSalts: string[] = [];

      mockQuery.mockImplementation((query: string, params: unknown[]) => {
        if (query.includes('INSERT INTO provider_key_metadata')) {
          capturedSalts.push(params[1] as string);
        }
        return Promise.resolve({ rows: [] });
      });

      await manager.registerKey('provider1', 'key1');

      expect(capturedSalts.length).toBeGreaterThanOrEqual(1);
      // Each salt should be 32 bytes = 64 hex characters
      capturedSalts.forEach(salt => {
        expect(salt.length).toBe(64);
        expect(salt).toMatch(/^[a-f0-9]{64}$/);
      });
    });

    it('should use PBKDF2 with 600000 iterations', async () => {
      // Verify the iteration count constant
      const crypto = require('crypto');
      const pbkdf2Spy = jest.spyOn(crypto, 'pbkdf2Sync');

      // Pre-populate salt to ensure deriveKey is called
      (manager as any).providerSalts.set('test-provider', Buffer.alloc(32, 0x42));

      try {
        manager['deriveKey']('test-provider');
      } catch {
        // Expected to fail due to mocking, but we can check the call
      }

      expect(pbkdf2Spy).toHaveBeenCalled();
      const call = pbkdf2Spy.mock.calls[0];
      expect(call[2]).toBe(600000); // iterations
      expect(call[3]).toBe(32); // key length
      expect(call[4]).toBe('sha256'); // digest

      pbkdf2Spy.mockRestore();
    });
  });

  describe('Encryption Security', () => {
    it('should use AES-256-GCM for encryption', async () => {
      const crypto = require('crypto');
      const createCipherSpy = jest.spyOn(crypto, 'createCipheriv');

      // Pre-populate salt
      (manager as any).providerSalts.set('test-provider', Buffer.alloc(32, 0x42));

      try {
        manager['encryptKey']('test-key', 'test-provider');
      } catch {
        // May fail due to mocking, but we can verify the algorithm
      }

      expect(createCipherSpy).toHaveBeenCalled();
      const algorithm = createCipherSpy.mock.calls[0][0];
      expect(algorithm).toBe('aes-256-gcm');

      createCipherSpy.mockRestore();
    });

    it('should generate unique IVs for each encryption', async () => {
      const crypto = require('crypto');
      const ivs: string[] = [];
      const createCipherSpy = jest.spyOn(crypto, 'createCipheriv')
        .mockImplementation((algorithm: string, key: Buffer, iv: Buffer) => {
          ivs.push(iv.toString('hex'));
          return {
            update: jest.fn().mockReturnValue(''),
            final: jest.fn().mockReturnValue(''),
            getAuthTag: jest.fn().mockReturnValue(Buffer.alloc(16))
          };
        });

      // Pre-populate salt
      (manager as any).providerSalts.set('test-provider', Buffer.alloc(32, 0x42));

      // Encrypt multiple times
      manager['encryptKey']('key1', 'test-provider');
      manager['encryptKey']('key2', 'test-provider');

      expect(ivs.length).toBe(2);
      expect(ivs[0]).not.toBe(ivs[1]); // IVs should be unique

      createCipherSpy.mockRestore();
    });

    it('should include authentication tag in encrypted output', async () => {
      // Pre-populate salt
      (manager as any).providerSalts.set('test-provider', Buffer.alloc(32, 0x42));

      const encrypted = manager['encryptKey']('test-key', 'test-provider');

      // Format: iv:authTag:ciphertext
      const parts = encrypted.split(':');
      expect(parts.length).toBe(3);
      expect(parts[0].length).toBe(32); // IV (16 bytes = 32 hex chars)
      expect(parts[1].length).toBe(32); // Auth tag (16 bytes = 32 hex chars)
      expect(parts[2].length).toBeGreaterThan(0); // Ciphertext
    });
  });

  describe('Secret Validation', () => {
    // P2-14: Each test sets its own env var and constructs a new manager
    it('should reject short encryption secrets', () => {
      process.env['KEY_ENCRYPTION_SECRET'] = 'short';

      expect(() => {
        new KeyRotationManager(mockPool as Pool);
      }).toThrow('must be at least 32 characters');
    });

    it('should reject weak encryption secrets', () => {
      process.env['KEY_ENCRYPTION_SECRET'] = 'password123456789012345678901234';

      expect(() => {
        new KeyRotationManager(mockPool as Pool);
      }).toThrow('appears to be weak');
    });

    it('should reject secrets with insufficient entropy', () => {
      process.env['KEY_ENCRYPTION_SECRET'] = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

      expect(() => {
        new KeyRotationManager(mockPool as Pool);
      }).toThrow('insufficient entropy');
    });

    it('should accept strong encryption secrets', () => {
      process.env['KEY_ENCRYPTION_SECRET'] = randomBytes(32).toString('hex');

      expect(() => {
        new KeyRotationManager(mockPool as Pool);
      }).not.toThrow();
    });
  });

  describe('Key Rotation Security', () => {
    it('should maintain dual-key period during rotation', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      // Pre-populate with existing key
      await manager.registerKey('provider1', 'original-key');

      // Mock queries for rotation
      mockQuery.mockResolvedValue({ rows: [] });

      // Trigger rotation
      await manager.rotateKey('provider1');

      // Should update with both new and previous key
      const updateCalls = mockQuery.mock.calls.filter(
        (call: [string, ...unknown[]]) =>
          call[0].includes('UPDATE api_keys') &&
          call[0].includes('previous_key')
      );
      expect(updateCalls.length).toBeGreaterThanOrEqual(1);
    });

    it('should schedule invalidation after rotation', async () => {
      mockQuery.mockResolvedValue({ rows: [] });

      await manager.registerKey('provider1', 'key1');
      await manager.rotateKey('provider1');

      const scheduleCalls = mockQuery.mock.calls.filter(
        (call: [string, ...unknown[]]) =>
          call[0].includes('scheduled_invalidation_at')
      );
      expect(scheduleCalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Error Handling', () => {
    it('should throw error when deriving key without salt', () => {
      expect(() => {
        manager['deriveKey']('unknown-provider');
      }).toThrow('No salt found for provider');
    });

    it('should handle decryption with invalid format', async () => {
      await expect(
        manager.decryptKey('invalid-format', 'provider1')
      ).rejects.toThrow('Invalid encrypted data format');
    });
  });
});
