import { pbkdf2, randomBytes, createCipheriv, createDecipheriv, createHmac } from 'crypto';
import { promisify } from 'util';
import { EventEmitter } from 'events';
import { LRUCache } from '../utils/lruCache';
import { Pool, PoolClient } from 'pg';
import { getLogger } from '@kernel/logger';
import { Mutex } from 'async-mutex';

const logger = getLogger('keyRotation');
const pbkdf2Async = promisify(pbkdf2);

/**
 * API Key Rotation System
 * Manages automatic rotation of API keys with zero downtime
 */

const PBKDF2_ITERATIONS = 600000; // OWASP recommendation
const GCM_IV_BYTES = 12;          // NIST SP 800-38D recommended 96-bit nonce
const GCM_AUTH_TAG_BYTES = 16;    // 128-bit authentication tag (full strength)

/**
 * Validate secret complexity.
 * FIX P2-02: Removed ^ anchor so weak patterns are caught anywhere in the string.
 * FIX P2-02: Replaced unique-character count with minimum-length + hex-format check.
 * Validation deferred to constructor to avoid module-level crash.
 */
function validateSecret(secret: string | undefined): string {
  if (!secret) {
    throw new Error(
      'KEY_ENCRYPTION_SECRET environment variable is required. ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (secret.length < 32) {
    throw new Error(
      'KEY_ENCRYPTION_SECRET must be at least 32 characters. ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  // FIX P2-02: Pattern matches anywhere (no ^ anchor), catches embedded weak words.
  const weakPatterns = /(password|secret|key|test|123|abc)/i;
  if (weakPatterns.test(secret)) {
    throw new Error('KEY_ENCRYPTION_SECRET appears to be weak. Please use a cryptographically secure random value.');
  }
  // FIX P2-02 / FIX: Entropy check.
  // For hex secrets (0-9a-f) each char carries only 4 bits, so 32 chars = 128 bits.
  // We require ≥64 hex chars (256 bits / 32 bytes) for AES-256-level key strength.
  // The earlier length < 32 guard ensures non-hex paths already have ≥32 chars, but
  // hex paths need double the character count for equivalent entropy.
  const isHex = /^[a-f0-9]+$/i.test(secret);
  if (isHex && secret.length < 64) {
    throw new Error(
      'KEY_ENCRYPTION_SECRET hex value must be at least 64 characters (256 bits / 32 bytes). ' +
      'Generate with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
    );
  }
  if (!isHex && secret.length < 48) {
    // Require more characters for non-hex to compensate for lower bits-per-char.
    const uniqueChars = new Set(secret).size;
    if (uniqueChars < 16) {
      throw new Error('KEY_ENCRYPTION_SECRET has insufficient entropy. Please use a more random value.');
    }
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
  // FIX: EXTRACT(DAY FROM ...) returns NULL if expires_at is NULL; type must reflect that.
  // The ?? 0 fallback in getRotationStatus handles the null case at runtime.
  days_until_expiry: number | null;
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

/** Row shape returned by loadKeysFromDatabase */
interface ApiKeyRow {
  provider: string;
  encrypted_key: string;
  previous_key: string | null;
  rotated_at: Date;
  expires_at: Date;
  rotation_interval_days: number;
  grace_period_days: number;
}

export class KeyRotationManager extends EventEmitter {
  private readonly db: Pool;
  private readonly keys = new Map<string, ApiKeyConfig>();
  private checkInterval: NodeJS.Timeout | undefined;
  private cleanupInterval: NodeJS.Timeout | undefined;
  // P1-FIX: Store random salts per provider for PBKDF2
  private readonly providerSalts = new Map<string, Buffer>();
  // Per-provider mutex to prevent race conditions in salt initialization
  private readonly saltMutexes = new Map<string, Mutex>();
  // Cache derived keys to avoid repeated PBKDF2 computation
  private readonly derivedKeyCache = new LRUCache<string, Buffer>({ maxSize: 100, ttlMs: 5 * 60 * 1000 });
  private readonly encryptionSecret: string;
  private readonly keyGenerator: KeyGeneratorFn;

  constructor(db: Pool, keyGenerator?: KeyGeneratorFn) {
    super();
    // Validate secret in constructor — crashes only this instance, not the module
    this.encryptionSecret = validateSecret(process.env['KEY_ENCRYPTION_SECRET']);
    // FIX P1-01: Register a default error listener so unhandled 'error' events do not
    // crash the Node.js process. Callers should attach their own handler for alerting.
    this.on('error', (err: unknown) => {
      logger.error(
        '[KeyRotation] Unhandled error event (attach an error listener to suppress this)',
        err instanceof Error ? err : new Error(String(err)),
      );
    });
    this.setMaxListeners(50);
    this.db = db;
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
        return `AKIA${randomBytes(16).toString('hex').toUpperCase().slice(0, 16)}`;
      default:
        return `key_${randomBytes(32).toString('hex')}`;
    }
  }

  /**
   * Start automatic key rotation checks.
   * FIX P0-01: Loads all keys from database before starting intervals so that
   * getKey() / getKeyWithFallback() return correct values after a restart.
   *
   * IMPORTANT: Callers must await this method.
   * The no-floating-promises ESLint rule will flag un-awaited calls.
   */
  async start(checkIntervalHours = 24): Promise<void> {
    // FIX P0-01: Populate in-memory map from DB before accepting requests.
    await this.loadKeysFromDatabase();

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

  /**
   * FIX P0-01: Load all non-revoked keys from the database into the in-memory map.
   * Called once during start() so that getKey() works correctly after any restart.
   */
  private async loadKeysFromDatabase(): Promise<void> {
    const { rows } = await this.db.query<ApiKeyRow>(
      `SELECT provider, encrypted_key, previous_key,
              rotated_at, expires_at, rotation_interval_days, grace_period_days
       FROM api_keys
       WHERE status NOT IN ('revoked')`,
    );
    for (const row of rows) {
      try {
        // Ensure salt is available (loads from provider_key_metadata)
        await this.ensureProviderSalt(row['provider']);
        const currentKey = await this.decryptKey(row['encrypted_key'], row['provider']);
        const previousKey = row['previous_key']
          ? await this.decryptKey(row['previous_key'], row['provider'])
          : undefined;
        this.keys.set(row['provider'], {
          provider: row['provider'],
          currentKey,
          previousKey,
          rotatedAt: row['rotated_at'],
          expiresAt: row['expires_at'],
          rotationIntervalDays: row['rotation_interval_days'],
          gracePeriodDays: row['grace_period_days'],
        });
      } catch (err) {
        // Log and continue — a single bad row should not prevent other keys from loading.
        logger.error(`[KeyRotation] Failed to load key for provider ${row['provider']}`, err instanceof Error ? err : new Error(String(err)));
      }
    }
    logger.info('[KeyRotation] Loaded keys from database', { count: this.keys.size, providers: Array.from(this.keys.keys()) });
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
    await this.ensureProviderSalt(provider);
    await this.storeKey(provider, key, rotationIntervalDays, gracePeriodDays);
    this.emit('keyRegistered', { provider, expiresAt: config.expiresAt });
  }

  /**
   * Get salt mutex for a provider, creating one if needed.
   * Safe in single-threaded JS: Map.get + conditional Map.set is not interrupted
   * by async yields since getSaltMutex is synchronous.
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
   * Serialized per-provider via mutex to prevent race conditions.
   */
  private async ensureProviderSalt(provider: string): Promise<void> {
    const mutex = this.getSaltMutex(provider);
    await mutex.runExclusive(async () => {
      if (this.providerSalts.has(provider)) {
        return; // Already loaded
      }
      // FIX BUG-04: Added typed generic to avoid implicit any on rows[0].
      // Changed dot notation to bracket notation per noPropertyAccessFromIndexSignature.
      const { rows } = await this.db.query<{ salt: string | null }>(
        'SELECT salt FROM provider_key_metadata WHERE provider = $1',
        [provider],
      );

      const row = rows[0];
      if (row && row['salt']) {
        this.providerSalts.set(provider, Buffer.from(row['salt'], 'hex'));
      } else {
        // FIX: Use DO NOTHING instead of DO UPDATE SET salt = EXCLUDED.salt.
        // In a multi-instance deployment, concurrent inserts would race and the last
        // writer would overwrite the first-written salt. Each instance would then
        // derive a different encryption key, causing cross-instance decryption failures.
        // DO NOTHING preserves the first-committed salt; after the insert we re-read
        // to load whichever salt actually won the race.
        const salt = randomBytes(32);
        await this.db.query(
          `INSERT INTO provider_key_metadata (provider, salt, created_at)
           VALUES ($1, $2, NOW())
           ON CONFLICT (provider) DO NOTHING`,
          [provider, salt.toString('hex')],
        );
        // Re-read the authoritative salt from DB (may differ from the one we generated
        // if another instance committed first).
        const { rows: reread } = await this.db.query<{ salt: string }>(
          'SELECT salt FROM provider_key_metadata WHERE provider = $1',
          [provider],
        );
        const authoritativeSalt = reread[0]?.['salt'];
        if (!authoritativeSalt) {
          throw new Error(`Failed to persist or read salt for provider ${provider}`);
        }
        this.providerSalts.set(provider, Buffer.from(authoritativeSalt, 'hex'));
      }
    });
  }

  /**
   * Store key in database (encrypted)
   */
  private async storeKey(provider: string, key: string, rotationIntervalDays: number, gracePeriodDays: number): Promise<void> {
    const encryptedKey = await this.encryptKey(key, provider);
    await this.db.query(
      `INSERT INTO api_keys (
         provider, encrypted_key, rotation_interval_days, grace_period_days,
         rotated_at, expires_at, status
       )
       VALUES ($1, $2, $3, $4, NOW(), NOW() + ($5 * INTERVAL '1 day'), 'active')
       ON CONFLICT (provider) DO UPDATE SET
         encrypted_key = EXCLUDED.encrypted_key,
         rotated_at = EXCLUDED.rotated_at,
         expires_at = EXCLUDED.expires_at,
         status = 'active'`,
      [provider, encryptedKey, rotationIntervalDays, gracePeriodDays, rotationIntervalDays],
    );
  }

  /**
   * Check and rotate keys that need rotation.
   * FIX P2-01: Added per-provider timeout so a single hung rotation cannot stall others.
   */
  async checkAndRotateKeys(): Promise<void> {
    const ROTATION_TIMEOUT_MS = 30_000;
    for (const [provider, config] of this.keys) {
      const daysUntilExpiry = (config.expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysUntilExpiry <= config.gracePeriodDays) {
        logger.info(`[KeyRotation] Key for ${provider} expires in ${daysUntilExpiry.toFixed(1)} days, rotating...`);
        await Promise.race([
          this.rotateKey(provider),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error(`Rotation timed out after ${ROTATION_TIMEOUT_MS}ms for ${provider}`)),
              ROTATION_TIMEOUT_MS,
            ),
          ),
        ]).catch((err: unknown) => {
          logger.error(`[KeyRotation] Rotation skipped for ${provider}`, err instanceof Error ? err : new Error(String(err)));
        });
      }
    }
  }

  /**
   * Rotate a specific key.
   * FIX P1-03: Invalidates derived-key cache before re-encrypting so decryption of
   * newly encrypted data cannot use a stale cached key.
   */
  async rotateKey(provider: string): Promise<boolean> {
    const config = this.keys.get(provider);
    if (!config) {
      logger.error(`[KeyRotation] No key registered for ${provider}`);
      return false;
    }
    const oldKeyId = this.hashKey(config.currentKey);
    try {
      await this.ensureProviderSalt(provider);
      // FIX P1-03: Invalidate cached derived key immediately so subsequent
      // encrypt/decrypt calls use a freshly derived key.
      this.derivedKeyCache.delete(provider);

      const newKey = await this.keyGenerator(provider);
      if (!newKey) {
        throw new Error(`Failed to generate new key for ${provider}`);
      }
      const newKeyId = this.hashKey(newKey);

      // FIX: Save original in-memory state before mutating. If the DB write fails,
      // the catch block restores these values so the in-memory map stays consistent
      // with the database. Without this, a DB failure leaves the in-memory map
      // claiming the new key is active while the DB still holds the old one.
      const savedCurrentKey = config.currentKey;
      const savedPreviousKey = config.previousKey;
      const savedRotatedAt = config.rotatedAt;
      const savedExpiresAt = config.expiresAt;

      config.previousKey = config.currentKey;
      config.currentKey = newKey;
      config.rotatedAt = new Date();
      config.expiresAt = new Date(Date.now() + config.rotationIntervalDays * 24 * 60 * 60 * 1000);
      try {
        await this.updateKeyInDatabase(provider, newKey, config.previousKey);
      } catch (dbErr) {
        // Roll back in-memory state: DB write failed, so the old key is still active.
        config.currentKey = savedCurrentKey;
        config.previousKey = savedPreviousKey;
        config.rotatedAt = savedRotatedAt;
        config.expiresAt = savedExpiresAt;
        throw dbErr;
      }
      await this.scheduleInvalidation(provider, config.gracePeriodDays);
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
    await this.db.query(
      `UPDATE api_keys
       SET scheduled_invalidation_at = $2,
           invalidation_status = 'pending'
       WHERE provider = $1`,
      [provider, invalidateAt],
    );
    logger.info(`[KeyRotation] Scheduled invalidation for ${provider} at ${invalidateAt.toISOString()}`);
  }

  /**
   * Process scheduled invalidations - called periodically.
   * FIX BUG-01: Replaced a single shared transaction (BEGIN / for-loop / COMMIT) with
   * per-provider autonomous transactions. The old design committed the entire batch even
   * when individual providers failed, silently leaving old keys active while marking
   * invalidation_status = 'completed'. Each provider now has its own BEGIN/COMMIT/ROLLBACK
   * so a failure for provider A does not affect provider B.
   *
   * FIX BUG-06: The old design held one PoolClient open across the loop and then called
   * invalidateOldKey() which issued this.db.query() — a second pool acquisition while one
   * connection was already held. Under pool exhaustion this deadlocked. Each provider now
   * acquires and fully releases its own connection, eliminating nested pool acquisition.
   */
  async processScheduledInvalidations(): Promise<void> {
    // Fetch candidates outside any transaction; a stale read is acceptable here
    // because each provider re-checks its own row under FOR UPDATE SKIP LOCKED below.
    const { rows: candidates } = await this.db.query<{ provider: string }>(
      `SELECT provider
       FROM api_keys
       WHERE scheduled_invalidation_at <= NOW()
         AND invalidation_status = 'pending'`,
    );

    for (const candidate of candidates) {
      let client: PoolClient | undefined;
      try {
        client = await this.db.connect();
        await client.query('BEGIN');

        // Re-check and lock only this provider's row. SKIP LOCKED ensures concurrent
        // instances skip rows already held by another process rather than queuing.
        const { rows: locked } = await client.query<{ provider: string }>(
          `SELECT provider
           FROM api_keys
           WHERE provider = $1
             AND scheduled_invalidation_at <= NOW()
             AND invalidation_status = 'pending'
           FOR UPDATE SKIP LOCKED`,
          [candidate['provider']],
        );

        if (locked.length === 0) {
          // Another instance already claimed this row; nothing to do.
          await client.query('ROLLBACK');
          continue;
        }

        // All DB writes go through the same client to avoid nested pool acquisition
        // inside an active transaction (root cause of the former BUG-06 deadlock).
        await client.query(
          `UPDATE api_keys
           SET previous_key = NULL,
               status = 'active',
               invalidation_status = 'completed'
           WHERE provider = $1`,
          [candidate['provider']],
        );

        await client.query('COMMIT');

        // FIX: Update in-memory state AFTER the DB COMMIT succeeds.
        // The previous code updated in-memory BEFORE COMMIT, so if COMMIT failed
        // (network drop, DB error), the in-memory map would say previousKey = undefined
        // while the DB still had the old key — a divergence causing silent auth failures.
        const config = this.keys.get(candidate['provider']);
        if (config) {
          config.previousKey = undefined;
        }

        this.emit('oldKeyInvalidated', { provider: candidate['provider'] });
        logger.info(`[KeyRotation] Completed invalidation for ${candidate['provider']}`);
      } catch (error) {
        if (client) {
          await client.query('ROLLBACK').catch((rbErr: unknown) => {
            logger.error(
              '[KeyRotation] Rollback failed in processScheduledInvalidations',
              rbErr instanceof Error ? rbErr : new Error(String(rbErr)),
            );
          });
        }
        logger.error(
          `[KeyRotation] Failed to invalidate old key for ${candidate['provider']}:`,
          error instanceof Error ? error : new Error(String(error)),
        );
        // FIX: emit('error', ...) must receive an Error instance. Emitting a plain object
        // bypasses the default error handler's `instanceof Error` check and can crash the
        // process in Node.js (unhandled 'error' event with a non-Error value).
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.emit('error', new Error(`Invalidation failed for ${candidate['provider']}: ${errorMsg}`));
        await this.alertOnInvalidationFailure(candidate['provider'], error);
      } finally {
        client?.release();
      }
    }
  }

  /**
   * Alert on invalidation failure
   */
  private async alertOnInvalidationFailure(provider: string, error: unknown): Promise<void> {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[KeyRotation] ALERT: Invalidation failed for ${provider}`, error instanceof Error ? error : new Error(String(error)));
    this.emit('alert', {
      severity: 'critical',
      message: `Key invalidation failed for ${provider}`,
      error: errorMsg,
      timestamp: new Date(),
    });
  }

  /**
   * Generate new key using the injected strategy
   */
  async generateNewKey(provider: string): Promise<string | null> {
    return this.keyGenerator(provider);
  }

  /**
   * Update key in database.
   * FIX P1-05: Checks rowCount and throws if no row was updated (provider not in DB).
   */
  private async updateKeyInDatabase(provider: string, newKey: string, previousKey: string | undefined): Promise<void> {
    const encryptedNewKey = await this.encryptKey(newKey, provider);
    const encryptedPreviousKey = previousKey
      ? await this.encryptKey(previousKey, provider)
      : null;
    const result = await this.db.query(
      `UPDATE api_keys SET
         encrypted_key = $1,
         previous_key = $2,
         rotated_at = NOW(),
         expires_at = NOW() + COALESCE(rotation_interval_days, 90) * INTERVAL '1 day',
         grace_period_end = NOW() + COALESCE(grace_period_days, 7) * INTERVAL '1 day',
         status = 'rotating'
       WHERE provider = $3`,
      [encryptedNewKey, encryptedPreviousKey, provider],
    );
    if (result.rowCount !== 1) {
      throw new Error(
        `updateKeyInDatabase: provider '${provider}' not found in database ` +
        `(rowCount=${result.rowCount}). In-memory state may have diverged from DB.`,
      );
    }
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
   * Derive encryption key using PBKDF2 (async).
   * FIX P1-07: Changed from pbkdf2Sync to async pbkdf2 to avoid blocking the
   * Node.js event loop for ~100-200ms per uncached call.
   * Results are cached for 5 minutes to amortise the cost across requests.
   */
  private async deriveKey(provider: string): Promise<Buffer> {
    const cached = this.derivedKeyCache.get(provider);
    if (cached) {
      return cached;
    }
    const salt = this.providerSalts.get(provider);
    if (!salt) {
      throw new Error(`No salt found for provider ${provider}. Key must be registered before use.`);
    }
    const derived = await pbkdf2Async(this.encryptionSecret, salt, PBKDF2_ITERATIONS, 32, 'sha256');
    this.derivedKeyCache.set(provider, derived);
    return derived;
  }

  /**
   * Encrypt key for storage using AES-256-GCM.
   * FIX P1-02: Changed from public to private — only used internally.
   * FIX P2-03: Changed IV from 16 bytes to 12 bytes per NIST SP 800-38D.
   */
  private async encryptKey(key: string, provider: string): Promise<string> {
    const derivedKey = await this.deriveKey(provider);
    const iv = randomBytes(GCM_IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', derivedKey, iv);
    let encrypted = cipher.update(key, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt key from storage.
   * FIX P1-09: Added explicit byte-length validation for IV and auth tag before use.
   * FIX BUG-02: Changed from public to private — only used internally by
   * loadKeysFromDatabase. Exposing decryption as a public method creates an
   * unnecessary decryption oracle on the instance.
   */
  private async decryptKey(encryptedData: string, provider: string): Promise<string> {
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
    // FIX P1-09: Validate IV and auth tag lengths before passing to crypto primitives.
    const ivBytes = Buffer.from(ivHex, 'hex');
    if (ivBytes.length !== GCM_IV_BYTES) {
      throw new Error(`Invalid IV length: expected ${GCM_IV_BYTES} bytes, got ${ivBytes.length}`);
    }
    const authTagBytes = Buffer.from(authTagHex, 'hex');
    if (authTagBytes.length !== GCM_AUTH_TAG_BYTES) {
      throw new Error(`Invalid GCM auth tag length: expected ${GCM_AUTH_TAG_BYTES} bytes, got ${authTagBytes.length}`);
    }
    await this.ensureProviderSalt(provider);
    const derivedKey = await this.deriveKey(provider);
    const decipher = createDecipheriv('aes-256-gcm', derivedKey, ivBytes);
    decipher.setAuthTag(authTagBytes);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  }

  /**
   * Hash key for identification in logs and events (not for storage or auth).
   * FIX P2-04: Uses HMAC-SHA256 with the instance secret instead of plain SHA256,
   * preventing pre-computation of a rainbow table against known key formats.
   * FIX BUG-03: Changed from public to private. Exposing this as a public method
   * creates a keyed-HMAC oracle over the master encryption secret: any caller with
   * a manager reference could probe arbitrary inputs and use the MAC prefix to
   * confirm key formats or fingerprint keys from event logs.
   */
  private hashKey(key: string): string {
    return createHmac('sha256', this.encryptionSecret).update(key).digest('hex').slice(0, 16);
  }

  /**
   * Get rotation status for all keys
   */
  async getRotationStatus(): Promise<Array<{ provider: string; status: string; rotatedAt: Date; expiresAt: Date; daysUntilExpiry: number }>> {
    const { rows } = await this.db.query<RotationStatusRow>(
      `SELECT provider, status, rotated_at, expires_at,
              EXTRACT(DAY FROM (expires_at - NOW())) as days_until_expiry
       FROM api_keys
       ORDER BY expires_at`,
    );
    return rows.map((r) => ({
      provider: r['provider'],
      status: r['status'],
      rotatedAt: r['rotated_at'],
      expiresAt: r['expires_at'],
      daysUntilExpiry: Math.max(0, r['days_until_expiry'] ?? 0),
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
   * Revoke a key immediately.
   * FIX P1-06: Also deletes the saltMutex to prevent unbounded memory growth
   * in deployments with frequent provider registration/revocation.
   */
  async revokeKey(provider: string): Promise<void> {
    this.keys.delete(provider);
    this.providerSalts.delete(provider);
    this.saltMutexes.delete(provider);  // FIX P1-06: prevent memory leak
    this.derivedKeyCache.delete(provider);
    await this.db.query(
      `UPDATE api_keys SET status = 'revoked', encrypted_key = NULL, previous_key = NULL
       WHERE provider = $1`,
      [provider],
    );
    this.emit('keyRevoked', { provider });
  }
}
