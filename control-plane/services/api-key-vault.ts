import { Fernet } from 'fernet';
import { Pool } from 'pg';
import { randomUUID } from 'crypto';

import { getLogger } from '../../packages/kernel/logger';

const logger = getLogger('api-key-vault');

// Lazy initialization variables
let key: string | null = null;
let fernet: Fernet | null = null;
let initError: Error | null = null;

/**
* Initialize the encryption key lazily.
* P1-FIX: Read from environment variable instead of filesystem to prevent
* CWD-dependent resolution, accidental git commits, and permission issues.
*/
function initializeKey(): void {
  if (key !== null) return;

  try {
  const envKey = process.env['MASTER_ENCRYPTION_KEY'];
  if (!envKey || envKey.trim().length === 0) {
    throw new Error('MASTER_ENCRYPTION_KEY environment variable is not set');
  }
  const trimmedKey = envKey.trim();
  if (trimmedKey.length < 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must be at least 32 characters');
  }
  key = trimmedKey;
  fernet = new Fernet(trimmedKey);
  } catch (error) {
  initError = error instanceof Error ? error : new Error(String(error));
  logger.error('Failed to initialize encryption key', initError);
  throw new Error('Failed to initialize API key vault: encryption key not configured');
  }
}

/**
* Get the encryption key (lazy initialization)
*/
function _getKey(): string {
  if (key === null) {
  initializeKey();
  }
  if (key === null) {
  throw new Error('Failed to initialize encryption key');
  }
  return key;
}

/**
* Get the Fernet instance (lazy initialization)
*/
function getFernet(): Fernet {
  if (fernet === null) {
  initializeKey();
  }
  if (fernet === null) {
  throw new Error('Failed to initialize Fernet');
  }
  return fernet;
}

export interface SetKeyResult {
  ok: boolean;
  id: string;
}

export interface RetrievedKey {
  id: string;
  org_id: string;
  provider: string;
  secret: string;
}

export interface IntegrationRecord {
  id: string;
  org_id: string;
  provider: string;
  encrypted_secret: string;
  encryption_version: number;
  status: string;
}

export class ApiKeyVault {
  constructor(private pool: Pool) {
  if (!pool) {
    throw new Error('Database pool is required');
  }
  }

  /**
  * Encrypts and stores an API key for an organization.
  *
  * @param orgId - Organization ID
  * @param provider - Provider name (e.g., 'stripe', 'sendgrid')
  * @param secret - The API secret/key to encrypt and store
  * @returns Result with success flag and record ID
  * @throws Error if validation fails or database operation fails
  */
  async set(orgId: string, provider: string, secret: string): Promise<SetKeyResult> {
  // Input validation
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId (string) is required');
  }
  if (!provider || typeof provider !== 'string') {
    throw new Error('Valid provider (string) is required');
  }
  if (!secret || typeof secret !== 'string') {
    throw new Error('Valid secret (string) is required');
  }
  if (secret.length < 1) {
    throw new Error('Secret cannot be empty');
  }

  const id = randomUUID();

  try {
    const f = getFernet();
    const encrypted = f.encrypt(secret);

    await this.pool.query(
    `INSERT INTO org_integrations
    (id, org_id, provider, credential_type, encrypted_secret, encryption_version, status, created_at, updated_at)
    VALUES ($1, $2, $3, 'api_key', $4, 1, 'active', NOW(), NOW())
    ON CONFLICT (org_id, provider)
    DO UPDATE SET
    encrypted_secret = $4,
    updated_at = NOW(),
    status = 'active',
    encryption_version = 1`,
    [id, orgId, provider, encrypted]
    );

    logger.info('Stored API key', { orgId, provider });

    return { ok: true, id };
  } catch (error) {
    logger.error('Error storing API key', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to store API key: ${error instanceof Error ? error.message : String(error)}`);
  }
  }

  /**
  * Retrieves and decrypts an API key for an organization.
  *
  * @param orgId - Organization ID
  * @param provider - Provider name
  * @returns The decrypted key data or null if not found
  * @throws Error if validation fails or decryption fails
  */
  async get(orgId: string, provider: string): Promise<RetrievedKey | null> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId (string) is required');
  }
  if (!provider || typeof provider !== 'string') {
    throw new Error('Valid provider (string) is required');
  }

  try {
    const { rows } = await this.pool.query<IntegrationRecord>(
    `SELECT id, org_id, provider, encrypted_secret, encryption_version, status
    FROM org_integrations
    WHERE org_id = $1 AND provider = $2 AND credential_type = 'api_key' AND status = 'active'`,
    [orgId, provider]
    );

    if (rows.length === 0) {
    return null;
    }

    const record = rows[0];
    if (!record) {
      return null;
    }

    if (!record['encrypted_secret'] || typeof record['encrypted_secret'] !== 'string') {
    throw new Error('Invalid encrypted secret format');
    }

    // Additional validation: Fernet tokens should be base64 with specific format
    const fernetTokenPattern = /^[A-Za-z0-9+/=]+$/;
    if (!fernetTokenPattern.test(record['encrypted_secret']) || record['encrypted_secret'].length < 32) {
    throw new Error('Malformed Fernet token');
    }

    // Decrypt the secret
    const f2 = getFernet();
    const decrypted = f2.decrypt(record['encrypted_secret']);

    return {
    id: record['id'],
    org_id: record['org_id'],
    provider: record['provider'],
    secret: decrypted
    };
  } catch (error) {
    logger.error('Error retrieving API key', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to retrieve API key: ${error instanceof Error ? error.message : String(error)}`);
  }
  }

  /**
  * Deletes (deactivates) an API key for an organization.
  *
  * @param orgId - Organization ID
  * @param provider - Provider name
  * @throws Error if validation fails or database operation fails
  */
  async delete(orgId: string, provider: string): Promise<void> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId (string) is required');
  }
  if (!provider || typeof provider !== 'string') {
    throw new Error('Valid provider (string) is required');
  }

  try {
    const result = await this.pool.query(
    `UPDATE org_integrations
    SET status = 'inactive', updated_at = NOW()
    WHERE org_id = $1 AND provider = $2 AND credential_type = 'api_key'`,
    [orgId, provider]
    );

    if (result.rowCount === 0) {
    throw new Error('API key not found');
    }

    logger.info('Deactivated API key', { orgId, provider });
  } catch (error) {
    logger.error('Error deleting API key', error instanceof Error ? error : new Error(String(error)));
    throw new Error(`Failed to delete API key: ${error instanceof Error ? error.message : String(error)}`);
  }
  }

  /**
  * Check if the vault is properly initialized
  */
  static isInitialized(): boolean {
  return key !== null && fernet !== null;
  }

  /**
  * Get initialization error if any
  */
  static getInitError(): Error | null {
  return initError;
  }
}
