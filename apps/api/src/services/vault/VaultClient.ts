
import { LRUCache } from 'lru-cache';

import { getLogger } from '@kernel/logger';

const logger = getLogger('VaultClient');

/**
* Vault client for secure secret storage
*
* MEDIUM FIX M1, M2, M3, M4: Enhanced vault client
* - Input validation
* - Error handling with context
* - Caching for frequently accessed secrets
* - Memory-efficient storage
*/

const MAX_ORG_ID_LENGTH = 100;
const MAX_KEY_LENGTH = 100;

export class VaultClient {
  private cache: LRUCache<string, Record<string, unknown>>;

  private readonly CACHE_TTL_MS = 5 * 60 * 1000;

  private readonly MAX_CACHE_SIZE = 1000;

  /**
  * Creates an instance of VaultClient
  * @param store - Key-value store for secrets
  */
  constructor(private readonly store: Record<string, Record<string, unknown>>) {
    if (!store || typeof store !== 'object') {
    throw new Error('Invalid store: must be an object');
  }

  this.cache = new LRUCache<string, Record<string, unknown>>({
    max: this.MAX_CACHE_SIZE,
    ttl: this.CACHE_TTL_MS
  });
  }

  /**
  * MEDIUM FIX M3: Validate orgId
  */
  private validateOrgId(orgId: string): void {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Invalid orgId: must be a non-empty string');
  }
  if (orgId.length > MAX_ORG_ID_LENGTH) {
    throw new Error(`Invalid orgId: exceeds maximum length of ${MAX_ORG_ID_LENGTH}`);
  }
  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(orgId)) {
    throw new Error('Invalid orgId: must be a valid UUID');
  }
  }

  /**
  * MEDIUM FIX M3: Validate key
  */
  private validateKey(key: string): void {
  if (!key || typeof key !== 'string') {
    throw new Error('Invalid key: must be a non-empty string');
  }
  if (key.length > MAX_KEY_LENGTH) {
    throw new Error(`Invalid key: exceeds maximum length of ${MAX_KEY_LENGTH}`);
  }
  // Allow only alphanumeric, hyphens, and underscores
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    throw new Error('Invalid key: must match pattern [a-zA-Z0-9_-]+');
  }
  }

  /**
  * MEDIUM FIX M4: Get cache key
  */
  private getCacheKey(orgId: string, key: string): string {
  return `${orgId}:${key}`;
  }

  private getFromCache(cacheKey: string): unknown | undefined {
  return this.cache.get(cacheKey);
  }

  private addToCache(cacheKey: string, secret: Record<string, unknown>): void {
  this.cache.set(cacheKey, secret);
  }

  /**
  * Retrieve a secret from the vault
  * @param orgId - Organization ID
  * @param key - Secret key
  * @returns The stored secret value
  * @throws Error if secret is not found
  */
  async getSecret(orgId: string, key: string): Promise<unknown> {
    this.validateOrgId(orgId);
  this.validateKey(key);

  const cacheKey = this.getCacheKey(orgId, key);

    const cached = this.getFromCache(cacheKey);
  if (cached !== undefined) {
    logger.debug(`Cache hit for ${cacheKey}`);
    return cached;
  }

  try {
    const secret = this.store[cacheKey];

    if (!secret) {
        // P1-FIX: Secret Leakage - Don't log sensitive key details
        logger.warn('Secret not found for org [REDACTED]');
    throw new Error(`Secret not found: ${key}`);
    }

    this.addToCache(cacheKey, secret);

    logger.debug('Secret retrieved for org [REDACTED]');
    return secret;
  } catch (error) {
    // Log and re-throw with context - check for specific error using error code or message
    const vaultError = error as Error & { code?: string };
    const isNotFoundError = error instanceof Error &&
    (vaultError.code === 'SECRET_NOT_FOUND' || error["message"].includes('Secret not found'));
    if (isNotFoundError) {
    throw error;
    }

    // P1-FIX: Secret Leakage - Redact sensitive info in error logs
    logger.error('Error retrieving secret for org [REDACTED]', {
    error: error instanceof Error ? '[REDACTED_ERROR]' : 'Unknown error' });
    throw new Error(`Failed to retrieve secret: ${error instanceof Error ? error["message"] : 'Unknown error'}`);
  }
  }

  /**
  * MEDIUM FIX M4: Clear the cache
  */
  clearCache(): void {
  this.cache.clear();
  logger.debug('Cache cleared');
  }

  /**
  * MEDIUM FIX M4: Get cache stats
  */
  getCacheStats(): { size: number; maxSize: number; ttlMs: number } {
  return {
    size: this.cache.size,
    maxSize: this.MAX_CACHE_SIZE,
    ttlMs: this.CACHE_TTL_MS,
  };
  }
}
