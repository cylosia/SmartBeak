import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv, createHash } from 'crypto';
import { EventEmitter } from 'events';

import { Mutex } from 'async-mutex';
import { Pool } from 'pg';

import { getLogger } from '@kernel/logger';

import { LRUCache } from '../utils/lruCache';

const logger = getLogger('keyRotation');

/**
 * API Key Rotation System
 * Manages automatic rotation of API keys with zero downtime
 */

const PBKDF2_ITERATIONS = 600000; // OWASP recommendation

/**
 * Validate secret complexity
 * SECURITY FIX: Validation deferred to constructor (P0-01) to avoid module-level crash
 */
function validateSecret(secret: string | undefined): string {
  if (!secret) {
    throw new Error('KEY_ENCRYPTION_SECRET environment variable is required. ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  if (secret.length < 32) {
    throw new Error('KEY_ENCRYPTION_SECRET must be at least 32 characters. ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
  }
  // Check for common weak patterns
  const weakPatterns = /^(password|secret|key|test|123|abc)/i;
  if (weakPatterns.test(secret)) {
    throw new Error('KEY_ENCRYPTION_SECRET appears to be weak. Please use a cryptographically secure random value.');
  }
  // Check for sufficient entropy (at least 128 bits)
  const uniqueChars = new Set(secret).size;
  if (uniqueChars < 16) {
    throw new Error('KEY_ENCRYPTION_SECRET has insufficient entropy. Please use a more random value.');
  }
  return secret;
}


export interface ApiKeyConfig {
  provider: string;
  currentKey: string;
  previousKey: string | undefined;
  rotatedAt: Date;
  expiresAt: Date;
  rotationIntervalDays: number;
  gracePeriodDays: number;
}

interface RotationStatusRow {
  provider: string;
  status: string;
  rotated_at: Date;
  expires_at: Date;
  days_until_expiry: number;
}

export interface KeyRotationEvent {
  provider: string;
  oldKeyId: string;
  newKeyId: string;
  rotatedAt: Date;
  status: 'success' | 'failed';
  error?: string;
}

/**
 * Strategy callback for generating new keys from a provider.
 * Default implementation creates random placeholder keys.
 * In production, replace with actual provider API calls
 * (e.g., OpenAI key rotation API, AWS IAM CreateAccessKey).
 */
export type KeyGeneratorFn = (provider: string) => Promise<string | null>;

export class KeyRotationManager extends EventEmitter {
  // P0-05: private readonly — prevent external access to raw DB pool
  private readonly db: Pool;
  // P0-06: private — prevent external access to plaintext keys
  private readonly keys = new Map<string, ApiKeyConfig>();
  private checkInterval: NodeJS.Timeout | undefined;
  private cleanupInterval: NodeJS.Timeout | undefined;
  // P1-FIX: Store random salts per provider for PBKDF2
  private readonly providerSalts = new Map<string, Buffer>();
  // ADVERSARIAL-02: Per-provider mutex to prevent race conditions in salt initialization
  private readonly saltMutexes = new Map<string, Mutex>();
  // P1-02: Cache derived keys to avoid repeated PBKDF2 computation
  private readonly derivedKeyCache = new LRUCache<string, Buffer>({ maxSize: 100, ttlMs: 5 * 60 * 1000 });
  // P0-01: Secret validated lazily per-instance, not at module level
  private readonly encryptionSecret: string;
  // P1-04: Pluggable key generation strategy
  private readonly keyGenerator: KeyGeneratorFn;

  constructor(db: Pool, keyGenerator?: KeyGeneratorFn) {
    super();
    // P0-01: Validate secret in constructor — crashes only this instance, not the module
    this.encryptionSecret = validateSecret(process.env['KEY_ENCRYPTION_SECRET']);
    this.setMaxListeners(50);
    this.db = db;
    // P1-04: Allow callers to inject real provider-specific key generation
    this.keyGenerator = keyGenerator ?? KeyRotationManager.defaultKeyGenerator;
  }

  /**
   * Default key generator (placeholder — generates structurally-correct but non-functional keys).
   * WARNING: These are NOT real provider keys. In production, inject a keyGenerator
   * that calls the actual provider APIs (OpenAI, AWS IAM, etc.).
   */
  private static async defaultKeyGenerator(provider: string): Promise<string | null> {
    switch (provider) {
      case 'openai':
        return `sk-${randomBytes(24).toString('hex')}`;
      case 'stability':
        return `sk-${randomBytes(24).toString('hex')}`;
      case 'aws':
        // P2-12: Use hex encoding for consistent length instead of base64 with stripping
        return `AKIA${randomBytes(16).toString('hex').toUpperCase().slice(0, 16)}`;
      default:
        return `key_${randomBytes(32).toString('hex')}`;
    }
  }

  /**
  * Start automatic key rotation checks
  */
  start(checkIntervalHours = 24): void {
    // P1-03: Handle promise rejection from runInitialCheck
    this.runInitialCheck().catch((err) => {
      logger.error('[KeyRotation] Unhandled error in initial check:', err instanceof Error ? err : new Error(String(err)));
      this.emit('error', { phase: 'initialCheck', error: err });
    });
    this.checkInterval = setInterval(() => {
      this.checkAndRotateKeys().catch((err) => {
        logger.error('[KeyRotation] Unhandled error in scheduled check:', err instanceof Error ? err : new Error(String(err)));
        this.emit('error', { phase: 'scheduledCheck', error: err });
      });
    }, checkIntervalHours * 60 * 60 * 1000).unref();
    // Run cleanup every hour to process scheduled invalidations
    this.cleanupInterval = setInterval(() => {
      this.processScheduledInvalidations().catch((err) => {
        logger.error('[KeyRotation] Unhandled error in scheduled invalidation:', err instanceof Error ? err : new Error(String(err)));
        this.emit('error', { phase: 'scheduledInvalidation', error: err });
      });
    }, 60 * 60 * 1000).unref();
    logger.info('[KeyRotation] Started with interval:', { checkIntervalHours });
  }

  async runInitialCheck(): Promise<void> {
    try {
      await this.checkAndRotateKeys();
      await this.processScheduledInvalidations();
    }
    catch (error) {
      logger.error('[KeyRotation] Initial check failed:', error instanceof Error ? error : new Error(String(error)));
      this.emit('error', { phase: 'initialCheck', error });
    }
  }
  /**
  * Stop rotation checks
  */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
    }
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = undefined;
    }
  }
  /**
  * Register an API key for rotation
  */
  async registerKey(provider: string, key: string, rotationIntervalDays = 90, gracePeriodDays = 7): Promise<void> {
    const config: ApiKeyConfig = {
      provider,
      currentKey: key,
      previousKey: undefined,
      rotatedAt: new Date(),
      expiresAt: new Date(Date.now() + rotationIntervalDays * 24 * 60 * 60 * 1000),
      rotationIntervalDays,
      gracePeriodDays,
    };
    this.keys.set(provider, config);
    // P1-FIX: Generate and store random salt for this provider
    await this.ensureProviderSalt(provider);
    // Store encrypted in database
    await this.storeKey(provider, key, rotationIntervalDays, gracePeriodDays);
    this.emit('keyRegistered', { provider, expiresAt: config.expiresAt });
  }

  /**
   * Get salt mutex for a provider, creating one if needed.
   * ADVERSARIAL-02: Prevents race conditions in concurrent salt initialization.
   */
  private getSaltMutex(provider: string): Mutex {
    let mutex = this.saltMutexes.get(provider);
    if (!mutex) {
      mutex = new Mutex();
      this.saltMutexes.set(provider, mutex);
    }
    return mutex;
  }

  /**
   * Ensure provider has a random salt stored.
   * ADVERSARIAL-02: Serialized per-provider via mutex to prevent race conditions.
   */
  private async ensureProviderSalt(provider: string): Promise<void> {
    const mutex = this.getSaltMutex(provider);
    await mutex.runExclusive(async () => {
      if (this.providerSalts.has(provider)) {
        return; // Already loaded
      }
      // Check if salt exists in database
      const { rows } = await this.db.query(
        'SELECT salt FROM provider_key_metadata WHERE provider = $1',
        [provider]
      );

      if (rows.length > 0 && rows[0].salt) {
        // Use existing salt
        this.providerSalts.set(provider, Buffer.from(rows[0].salt, 'hex'));
      } else {
        // Generate new random salt
        const salt = randomBytes(32);
        this.providerSalts.set(provider, salt);

        // Store salt in database
        await this.db.query(
          `INSERT INTO provider_key_metadata (provider, salt, created_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (provider) DO UPDATE SET salt = EXCLUDED.salt`,
          [provider, salt.toString('hex')]
        );
      }
    });
  }
  /**
  * Store key in database (encrypted)
  */
  private async storeKey(provider: string, key: string, rotationIntervalDays: number, gracePeriodDays: number): Promise<void> {
    const encryptedKey = this.encryptKey(key, provider);
    await this.db.query(`INSERT INTO api_keys (
    provider, encrypted_key, rotation_interval_days, grace_period_days,
    rotated_at, expires_at, status
    )
    VALUES ($1, $2, $3, $4, NOW(), NOW() + ($5 * INTERVAL '1 day'), 'active')
    ON CONFLICT (provider) DO UPDATE SET
    encrypted_key = EXCLUDED.encrypted_key,
    rotated_at = EXCLUDED.rotated_at,
    expires_at = EXCLUDED.expires_at,
    status = 'active'`, [provider, encryptedKey, rotationIntervalDays, gracePeriodDays, rotationIntervalDays]);
  }
  /**
  * Check and rotate keys that need rotation
  */
  async checkAndRotateKeys(): Promise<void> {
    for (const [provider, config] of this.keys) {
      const daysUntilExpiry = (config.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysUntilExpiry <= config.gracePeriodDays) {
        logger.info(`[KeyRotation] Key for ${provider} expires in ${daysUntilExpiry.toFixed(1)} days, rotating...`);
        await this.rotateKey(provider);
      }
    }
  }
  /**
  * Rotate a specific key
  */
  async rotateKey(provider: string): Promise<boolean> {
    const config = this.keys.get(provider);
    if (!config) {
      logger.error(`[KeyRotation] No key registered for ${provider}`);
      return false;
    }
    const oldKeyId = this.hashKey(config.currentKey);
    try {
      // Ensure salt exists before rotation
      await this.ensureProviderSalt(provider);

      // Generate or fetch new key from provider (P1-04: uses injected strategy)
      const newKey = await this.keyGenerator(provider);
      if (!newKey) {
        throw new Error(`Failed to generate new key for ${provider}`);
      }
      // Phase 1: Store new key alongside old key (dual-key period)
      const newKeyId = this.hashKey(newKey);
      config.previousKey = config.currentKey;
      config.currentKey = newKey;
      config.rotatedAt = new Date();
      config.expiresAt = new Date(Date.now() + config.rotationIntervalDays * 24 * 60 * 60 * 1000);
      // Update database
      await this.updateKeyInDatabase(provider, newKey, config.previousKey);
      // Persist scheduled invalidation time
      await this.scheduleInvalidation(provider, config.gracePeriodDays);
      // Emit event
      const event: KeyRotationEvent = {
        provider,
        oldKeyId,
        newKeyId,
        rotatedAt: new Date(),
        status: 'success',
      };
      this.emit('keyRotated', event);
      logger.info(`[KeyRotation] Successfully rotated key for ${provider}`);
      return true;
    }
    catch (error) {
      // P1-11: Sanitize error messages to prevent leaking key material
      const rawMsg = error instanceof Error ? error.message : 'Unknown error';
      const errorMsg = rawMsg.replace(/[0-9a-f]{16,}/gi, '[REDACTED]');
      const event: KeyRotationEvent = {
        provider,
        oldKeyId,
        newKeyId: '',
        rotatedAt: new Date(),
        status: 'failed',
        error: errorMsg,
      };
      this.emit('rotationFailed', event);
      logger.error(`[KeyRotation] Failed to rotate key for ${provider}:`, error instanceof Error ? error : new Error(rawMsg));
      this.emit('error', new Error(`Rotation failed for ${provider}: ${errorMsg}`));
      return false;
    }
  }
  /**
  * Persist scheduled invalidation time to database
  */
  private async scheduleInvalidation(provider: string, gracePeriodDays: number): Promise<void> {
    const invalidateAt = new Date(Date.now() + gracePeriodDays * 24 * 60 * 60 * 1000);
    await this.db.query(`UPDATE api_keys
    SET scheduled_invalidation_at = $2,
      invalidation_status = 'pending'
    WHERE provider = $1`, [provider, invalidateAt]);
    logger.info(`[KeyRotation] Scheduled invalidation for ${provider} at ${invalidateAt.toISOString()}`);
  }
  /**
  * Process scheduled invalidations - called periodically
  */
  async processScheduledInvalidations(): Promise<void> {
    try {
      const { rows } = await this.db.query<{ provider: string }>(`SELECT provider
    FROM api_keys
    WHERE scheduled_invalidation_at <= NOW()
    AND invalidation_status = 'pending'`);
      for (const row of rows) {
        try {
          await this.invalidateOldKey(row.provider);
          await this.db.query(`UPDATE api_keys
      SET invalidation_status = 'completed',
        previous_key = NULL
      WHERE provider = $1`, [row.provider]);
          logger.info(`[KeyRotation] Completed invalidation for ${row.provider}`);
        }
        catch (error) {
          logger.error(`[KeyRotation] Failed to invalidate old key for ${row.provider}:`, error instanceof Error ? error : new Error(String(error)));
          this.emit('error', { phase: 'invalidation', provider: row.provider, error });
          // Alert on failure - don't silently fail
          await this.alertOnInvalidationFailure(row.provider, error);
        }
      }
    }
    catch (error) {
      logger.error('[KeyRotation] Error processing scheduled invalidations:', error instanceof Error ? error : new Error(String(error)));
      this.emit('error', { phase: 'processScheduledInvalidations', error });
    }
  }
  /**
  * Alert on invalidation failure
  */
  private async alertOnInvalidationFailure(provider: string, error: unknown): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    // In production, integrate with alerting system (PagerDuty, Slack, etc.)
    logger.error(`[KeyRotation] ALERT: Invalidation failed for ${provider}`, error instanceof Error ? error : new Error(String(error)));
    this.emit('alert', {
      severity: 'critical',
      message: `Key invalidation failed for ${provider}`,
      error: errorMsg,
      timestamp: new Date(),
    });
  }
  /**
  * Generate new key using the injected strategy (P1-04)
  * @param provider - The provider name
  * @returns The generated API key or null if generation fails
  */
  async generateNewKey(provider: string): Promise<string | null> {
    return this.keyGenerator(provider);
  }
  /**
  * Update key in database
  */
  private async updateKeyInDatabase(provider: string, newKey: string, previousKey: string | undefined): Promise<void> {
    const encryptedNewKey = this.encryptKey(newKey, provider);
    const encryptedPreviousKey = previousKey
      ? this.encryptKey(previousKey, provider)
      : null;
    await this.db.query(`UPDATE api_keys SET
    encrypted_key = $1,
    previous_key = $2,
    rotated_at = NOW(),
    expires_at = NOW() + COALESCE(rotation_interval_days, 90) * INTERVAL '1 day',
    grace_period_end = NOW() + COALESCE(grace_period_days, 7) * INTERVAL '1 day',
    status = 'rotating'
    WHERE provider = $3`, [encryptedNewKey, encryptedPreviousKey, provider]);
  }
  /**
  * Invalidate old key after grace period
  */
  private async invalidateOldKey(provider: string): Promise<void> {
    const config = this.keys.get(provider);
    if (!config)
      return;
    config.previousKey = undefined;
    await this.db.query(`UPDATE api_keys SET
    previous_key = NULL,
    status = 'active'
    WHERE provider = $1`, [provider]);
    this.emit('oldKeyInvalidated', { provider });
    logger.info(`[KeyRotation] Old key invalidated for ${provider}`);
  }
  /**
  * Get current key for provider
  */
  async getKey(provider: string): Promise<string | undefined> {
    const config = this.keys.get(provider);
    return config?.currentKey;
  }
  /**
  * Get key with fallback to previous key during rotation
  */
  async getKeyWithFallback(provider: string): Promise<string | undefined> {
    const config = this.keys.get(provider);
    if (!config)
      return undefined;
    if (config.currentKey) {
      return config.currentKey;
    }
    return config.previousKey;
  }
  /**
  * Derive encryption key using PBKDF2
  * P1-02: Results are cached to avoid blocking the event loop on every call.
  */
  deriveKey(provider: string): Buffer {
    // P1-02: Check cache first
    const cached = this.derivedKeyCache.get(provider);
    if (cached) {
      return cached;
    }
    const salt = this.providerSalts.get(provider);
    if (!salt) {
      throw new Error(`No salt found for provider ${provider}. Key must be registered before use.`);
    }
    // P0-01: Use instance secret instead of module-level constant
    const derived = pbkdf2Sync(this.encryptionSecret, salt, PBKDF2_ITERATIONS, 32, 'sha256');
    // P1-02: Cache the derived key
    this.derivedKeyCache.set(provider, derived);
    return derived;
  }
  /**
  * Encrypt key for storage using AES-256-GCM
  */
  encryptKey(key: string, provider: string): string {
    const derivedKey = this.deriveKey(provider);
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);
    let encrypted = cipher.update(key, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }
  /**
  * Decrypt key from storage
  * ADVERSARIAL-01: Properly handles encrypted data with extra ':' in ciphertext
  */
  async decryptKey(encryptedData: string, provider: string): Promise<string> {
    // ADVERSARIAL-01: Split and validate exact part count
    const parts = encryptedData.split(':');
    if (parts.length < 3) {
      throw new Error('Invalid encrypted data format: expected iv:authTag:ciphertext');
    }
    const ivHex = parts[0];
    const authTagHex = parts[1];
    // Handle potential ':' in ciphertext by joining remaining parts
    const encrypted = parts.slice(2).join(':');
    if (!ivHex || !authTagHex || !encrypted) {
      throw new Error('Invalid encrypted data format');
    }
    // P1-FIX: Ensure salt is loaded before decryption
    await this.ensureProviderSalt(provider);
    const derivedKey = this.deriveKey(provider);
    const decipher = createDecipheriv('aes-256-gcm', derivedKey, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }
  /**
  * Hash key for identification (not for storage)
  */
  hashKey(key: string): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 16);
  }

  /**
  * Get rotation status for all keys
  */
  async getRotationStatus(): Promise<Array<{ provider: string; status: string; rotatedAt: Date; expiresAt: Date; daysUntilExpiry: number }>> {
    const { rows } = await this.db.query<RotationStatusRow>(`SELECT
    provider,
    status,
    rotated_at,
    expires_at,
    EXTRACT(DAY FROM (expires_at - NOW())) as days_until_expiry
    FROM api_keys
    ORDER BY expires_at`);
    return rows.map((r) => ({
      provider: r.provider,
      status: r.status,
      rotatedAt: r.rotated_at,
      expiresAt: r.expires_at,
      // P3-03: Simplified double-conversion
      daysUntilExpiry: Math.max(0, Number(r.days_until_expiry)),
    }));
  }
  /**
  * Force immediate rotation
  */
  async forceRotation(provider: string): Promise<boolean> {
    logger.info(`[KeyRotation] Force rotating key for ${provider}`);
    return this.rotateKey(provider);
  }
  /**
  * Revoke a key immediately
  */
  async revokeKey(provider: string): Promise<void> {
    this.keys.delete(provider);
    this.providerSalts.delete(provider);
    // P1-02: Clear derived key cache for this provider
    this.derivedKeyCache.delete(provider);
    await this.db.query(`UPDATE api_keys SET
    status = 'revoked',
    encrypted_key = NULL,
    previous_key = NULL
    WHERE provider = $1`, [provider]);
    this.emit('keyRevoked', { provider });
  }
}
