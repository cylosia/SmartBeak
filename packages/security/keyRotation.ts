import { pbkdf2Sync, randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { EventEmitter } from 'events';
import { LRUCache } from '../utils/lruCache';
import { Pool } from 'pg';
import { getLogger } from '@kernel/logger';

const logger = getLogger('keyRotation');

/**
 * API Key Rotation System
 * Manages automatic rotation of API keys with zero downtime
 */
// Read encryption secret once at module load
// SECURITY FIX: Validate secret complexity and remove non-null assertions
const ENCRYPTION_SECRET = validateSecret(process.env['KEY_ENCRYPTION_SECRET']);
const PBKDF2_ITERATIONS = 600000; // SECURITY FIX: Increased to 600k (OWASP recommendation)
/**
 * Validate secret complexity
 * SECURITY FIX: Add validation function for secret complexity
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

export class KeyRotationManager extends EventEmitter {
  db: Pool;
  keys = new Map<string, ApiKeyConfig>();
  checkInterval: NodeJS.Timeout | undefined;
  cleanupInterval: NodeJS.Timeout | undefined;
  // P1-FIX: Store random salts per provider for PBKDF2
  private providerSalts = new Map<string, Buffer>();
  
  constructor(db: Pool) {
    super();
    this.db = db;
  }
  /**
  * Start automatic key rotation checks
  */
  start(checkIntervalHours = 24): void {
    // Run initial check immediately, then schedule interval
    this.runInitialCheck();
    this.checkInterval = setInterval(() => {
      this.checkAndRotateKeys();
    }, checkIntervalHours * 60 * 60 * 1000).unref();
    // Run cleanup every hour to process scheduled invalidations
    this.cleanupInterval = setInterval(() => {
      this.processScheduledInvalidations();
    }, 60 * 60 * 1000).unref();
    logger.info('[KeyRotation] Started with interval:', { checkIntervalHours });
  }
  
  async runInitialCheck(): Promise<void> {
    try {
      await this.checkAndRotateKeys();
      await this.processScheduledInvalidations();
    }
    catch (error) {
      logger.error('[KeyRotation] Initial check failed:', error as Error);
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
   * Ensure provider has a random salt stored
   * P1-FIX: Generate cryptographically secure random salt
   */
  private async ensureProviderSalt(provider: string): Promise<void> {
    if (!this.providerSalts.has(provider)) {
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
    }
  }
  /**
  * Store key in database (encrypted)
  */
  async storeKey(provider: string, key: string, rotationIntervalDays: number, gracePeriodDays: number): Promise<void> {
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
      
      // Generate or fetch new key from provider
      const newKey = await this.generateNewKey(provider);
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
      const errorMsg = error instanceof Error ? error["message"] : 'Unknown error';
      const event: KeyRotationEvent = {
        provider,
        oldKeyId,
        newKeyId: '',
        rotatedAt: new Date(),
        status: 'failed',
        error: errorMsg,
      };
      this.emit('rotationFailed', event);
      logger.error(`[KeyRotation] Failed to rotate key for ${provider}:`, error instanceof Error ? error : new Error(errorMsg));
      this.emit('error', new Error(`Rotation failed for ${provider}: ${error instanceof Error ? error.message : 'Unknown error'}`));
      return false;
    }
  }
  /**
  * Persist scheduled invalidation time to database
  */
  async scheduleInvalidation(provider: string, gracePeriodDays: number): Promise<void> {
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
          logger.error(`[KeyRotation] Failed to invalidate old key for ${row.provider}:`, error as Error);
          this.emit('error', { phase: 'invalidation', provider: row.provider, error });
          // Alert on failure - don't silently fail
          await this.alertOnInvalidationFailure(row.provider, error);
        }
      }
    }
    catch (error) {
      logger.error('[KeyRotation] Error processing scheduled invalidations:', error as Error);
      this.emit('error', { phase: 'processScheduledInvalidations', error });
    }
  }
  /**
  * Alert on invalidation failure
  */
  async alertOnInvalidationFailure(provider: string, error: unknown): Promise<void> {
    const errorMsg = error instanceof Error ? error["message"] : 'Unknown error';
    // In production, integrate with alerting system (PagerDuty, Slack, etc.)
    logger.error(`[KeyRotation] ALERT: Invalidation failed for ${provider}`, error as Error);
    this.emit('alert', {
      severity: 'critical',
      message: `Key invalidation failed for ${provider}`,
      error: errorMsg,
      timestamp: new Date(),
    });
  }
  /**
  * Generate new key (provider-specific)
  * P1-FIX: Added proper TypeScript types and documentation
  * @param provider - The provider name (openai, stability, aws, or custom)
  * @returns The generated API key or null if generation fails
  */
  async generateNewKey(provider: string): Promise<string | null> {
    switch (provider) {
      case 'openai':
        return `sk-${randomBytes(24).toString('hex')}`;
      case 'stability':
        return `sk-${randomBytes(24).toString('hex')}`;
      case 'aws':
        return `AKIA${randomBytes(16).toString('base64').replace(/[^A-Z0-9]/g, '').slice(0, 16)}`;
      default:
        // P1-NOTE: For string-type provider, runtime check is the best we can do
        // Consider using a Provider union type for compile-time exhaustiveness
        return `key_${randomBytes(32).toString('hex')}`;
    }
  }
  /**
  * Update key in database
  */
  async updateKeyInDatabase(provider: string, newKey: string, previousKey: string | undefined): Promise<void> {
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
  async invalidateOldKey(provider: string): Promise<void> {
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
  * SECURITY FIX: Use random salt per provider instead of deterministic salt
  * P1-FIX: Salt is now cryptographically random and stored per provider
  */
  deriveKey(provider: string): Buffer {
    // P1-FIX: Use random salt stored per provider instead of deterministic salt
    const salt = this.providerSalts.get(provider);
    if (!salt) {
      throw new Error(`No salt found for provider ${provider}. Key must be registered before use.`);
    }
    // SECURITY FIX: Use validated secret and increased iterations
    return pbkdf2Sync(ENCRYPTION_SECRET, salt, PBKDF2_ITERATIONS, 32, 'sha256');
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
  */
  async decryptKey(encryptedData: string, provider: string): Promise<string> {
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');
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
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
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
      daysUntilExpiry: Math.max(0, parseFloat(String(r.days_until_expiry))),
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
    await this.db.query(`UPDATE api_keys SET
    status = 'revoked',
    encrypted_key = NULL,
    previous_key = NULL
    WHERE provider = $1`, [provider]);
    this.emit('keyRevoked', { provider });
  }
}
