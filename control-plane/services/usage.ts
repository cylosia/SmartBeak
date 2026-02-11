
// Valid fields for usage tracking - prevents SQL injection
import { Pool } from 'pg';

const VALID_FIELDS = ['domain_count', 'content_count', 'media_count', 'publish_count'] as const;
export type UsageField = typeof VALID_FIELDS[number];

// Magic number constants
const DEFAULT_USAGE_VALUE = 0;
const MIN_SECRET_LENGTH = 1;
const BYTES_PER_KB = 1024;

/**
* Service for tracking organization usage metrics
*
* Provides methods for incrementing, decrementing, and retrieving
* usage counters for domains, content, media, and publishes.
*
* @example
* ```typescript
* const usageService = new UsageService(pool);
* await usageService.increment('org-123', 'domain_count');
* const usage = await usageService.getUsage('org-123');
* ```
*/
export class UsageService {
  /**
  * Creates a new UsageService instance
  * @param pool - PostgreSQL connection pool
  */
  constructor(private pool: Pool) {}

  /**
  * Validate field name against whitelist
  */
  private validateField(field: string): asserts field is UsageField {
  if (!VALID_FIELDS.includes(field as UsageField)) {
    throw new Error(`Invalid field: ${field}. Must be one of: ${VALID_FIELDS.join(', ')}`);
  }
  }

  /**
  * Ensures an organization record exists in the usage table
  * Creates the record if it doesn't exist (idempotent)
  *
  * @param orgId - Organization ID to ensure
  * @throws Error if orgId is invalid
  */
  async ensureOrg(orgId: string): Promise<void> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId is required');
  }

  await this.pool.query(
    `INSERT INTO org_usage (org_id)
    VALUES ($1)
    ON CONFLICT (org_id) DO NOTHING`,
    [orgId]
  );
  }

  /**
  * Increments a usage counter for an organization
  *
  * @param orgId - Organization ID
  * @param field - Usage field to increment (domain_count, content_count, media_count, publish_count)
  * @param by - Amount to increment by (default: 1)
  * @returns Number of rows affected
  * @throws Error if orgId is invalid, field is not whitelisted, or increment value is not an integer
  *
  * @example
  * ```typescript
  * await usageService.increment('org-123', 'domain_count');
  * await usageService.increment('org-123', 'content_count', 5);
  * ```
  */
  async increment(orgId: string, field: UsageField, by = 1): Promise<number> {
  // Validate field against whitelist to prevent SQL injection
  this.validateField(field);

  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId is required');
  }
  if (typeof by !== 'number' || !Number.isInteger(by)) {
    throw new Error('Increment value must be an integer');
  }

  await this.ensureOrg(orgId);

  // SECURITY: Field is validated against whitelist before use
  // The validateField() call ensures only allowed column names are used
  // This prevents SQL injection through the field parameter
  const { rowCount } = await this.pool.query(
    `UPDATE org_usage
    SET ${field} = ${field} + $2,
    updated_at = now()
    WHERE org_id = $1`,
    [orgId, by]
  );
  return rowCount ?? DEFAULT_USAGE_VALUE;
  }

  /**
  * Retrieves current usage metrics for an organization
  *
  * @param orgId - Organization ID
  * @returns Usage record with all counters, or default values if no record exists
  * @throws Error if orgId is invalid
  *
  * @example
  * ```typescript
  * const usage = await usageService.getUsage('org-123');
  * // Example: logger.info('Domain count', { count: usage["domain_count"] });
  * ```
  */
  async getUsage(orgId: string): Promise<Record<string, unknown>> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId is required');
  }

  const { rows } = await this.pool.query(
    'SELECT * FROM org_usage WHERE org_id=$1',
    [orgId]
  );
  return rows[0] ?? {
    org_id: orgId,
    domain_count: DEFAULT_USAGE_VALUE,
    content_count: DEFAULT_USAGE_VALUE,
    media_count: DEFAULT_USAGE_VALUE,
    publish_count: DEFAULT_USAGE_VALUE
  };
  }

  /**
  * Decrements a usage counter for an organization
  * Used primarily for cleanup operations when resources are deleted
  *
  * @param orgId - Organization ID
  * @param field - Usage field to decrement
  * @param by - Amount to decrement by (default: 1)
  * @returns Number of rows affected
  * @throws Error if orgId is invalid, field is not whitelisted, or decrement value is negative
  *
  * @example
  * ```typescript
  * await usageService.decrement('org-123', 'domain_count');
  * ```
  */
  async decrement(orgId: string, field: UsageField, by = 1): Promise<number> {
  this.validateField(field);

  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId is required');
  }
  if (typeof by !== 'number' || !Number.isInteger(by) || by < 0) {
    throw new Error('Decrement value must be a non-negative integer');
  }

  const { rowCount } = await this.pool.query(
    `UPDATE org_usage
    SET ${field} = GREATEST(0, ${field} - $2),
    updated_at = now()
    WHERE org_id = $1`,
    [orgId, by]
  );
  return rowCount ?? DEFAULT_USAGE_VALUE;
  }

  /**
  * Sets a usage counter to a specific value
  * Used for synchronization operations when exact counts are known
  *
  * @param orgId - Organization ID
  * @param field - Usage field to set
  * @param value - Value to set (must be non-negative integer)
  * @returns Number of rows affected
  * @throws Error if orgId is invalid, field is not whitelisted, or value is negative
  *
  * @example
  * ```typescript
  * await usageService.set('org-123', 'domain_count', 10);
  * ```
  */
  async set(orgId: string, field: UsageField, value: number): Promise<number> {
  this.validateField(field);

  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId is required');
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error('Value must be a non-negative integer');
  }

  await this.ensureOrg(orgId);

  const { rowCount } = await this.pool.query(
    `UPDATE org_usage
    SET ${field} = $2,
    updated_at = now()
    WHERE org_id = $1`,
    [orgId, value]
  );
  return rowCount ?? DEFAULT_USAGE_VALUE;
  }
}
