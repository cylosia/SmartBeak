
// Valid fields for usage tracking - prevents SQL injection
import { Pool } from 'pg';

const VALID_FIELDS = ['domain_count', 'content_count', 'media_count', 'publish_count'] as const;
export type UsageField = typeof VALID_FIELDS[number];

// Magic number constants
const DEFAULT_USAGE_VALUE = 0;

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
  // Cache org existence to avoid an INSERT…ON CONFLICT before every increment.
  //
  // Two problems with a plain Set:
  //   1. Race condition: check-then-act is not atomic across await boundaries.
  //      Two concurrent requests for the same new org both see has() = false
  //      and both call ensureOrg(), doubling DB writes.
  //   2. Unbounded growth: a long-lived service handling millions of orgs will
  //      eventually exhaust heap memory.
  //
  // Fix: coalesce concurrent calls via a pending-Promise map, and evict the
  // set when it exceeds MAX_KNOWN_ORGS to cap memory usage.
  private knownOrgs = new Set<string>();
  private pendingEnsureOrg = new Map<string, Promise<void>>();
  private static readonly MAX_KNOWN_ORGS = 10_000;

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
  // P1-FIX: Reject non-positive values — by=0 is a wasted DB round-trip that stamps
  // updated_at without changing any counter. Reject values exceeding PostgreSQL INTEGER
  // max (2,147,483,647) to prevent integer overflow errors on the DB side.
  if (typeof by !== 'number' || !Number.isInteger(by) || by < 1 || by > 2_147_483_647) {
    throw new Error('Increment value must be a positive integer no greater than 2,147,483,647');
  }

  if (!this.knownOrgs.has(orgId)) {
    // Coalesce concurrent first-time calls for the same org into one DB round-trip.
    if (!this.pendingEnsureOrg.has(orgId)) {
      // P1-FIX: On rejection, remove the entry so the next call can retry rather than
      // awaiting the same permanently-rejected Promise (which would permanently break
      // usage tracking for this org until the process restarts).
      const p = this.ensureOrg(orgId)
        .then(() => {
          this.knownOrgs.add(orgId);
          // Simple cap — evict the entire set rather than implementing an LRU to
          // keep the code dependency-free. The next request re-warms the cache.
          if (this.knownOrgs.size > UsageService.MAX_KNOWN_ORGS) {
            this.knownOrgs.clear();
          }
        })
        .finally(() => {
          this.pendingEnsureOrg.delete(orgId);
        });
      this.pendingEnsureOrg.set(orgId, p);
    }
    await this.pendingEnsureOrg.get(orgId);
  }

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

  // P2-FIX #20: Select explicit columns instead of SELECT * to prevent
  // over-fetching and leaking internal columns if the table grows.
  const { rows } = await this.pool.query(
    'SELECT org_id, domain_count, content_count, media_count, publish_count, updated_at FROM org_usage WHERE org_id=$1',
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
  // P1-FIX: Match increment() validation — positive integer, capped at PG INTEGER max.
  if (typeof by !== 'number' || !Number.isInteger(by) || by < 1 || by > 2_147_483_647) {
    throw new Error('Decrement value must be a positive integer no greater than 2,147,483,647');
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
  // P1-FIX: Cap at PG INTEGER max to prevent overflow errors on the DB side.
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 2_147_483_647) {
    throw new Error('Value must be a non-negative integer no greater than 2,147,483,647');
  }

  if (!this.knownOrgs.has(orgId)) {
    if (!this.pendingEnsureOrg.has(orgId)) {
      // P1-FIX: Use .finally() so the entry is removed on both success and rejection,
      // allowing retry on transient DB errors instead of caching the failure forever.
      const p = this.ensureOrg(orgId)
        .then(() => {
          this.knownOrgs.add(orgId);
          if (this.knownOrgs.size > UsageService.MAX_KNOWN_ORGS) {
            this.knownOrgs.clear();
          }
        })
        .finally(() => {
          this.pendingEnsureOrg.delete(orgId);
        });
      this.pendingEnsureOrg.set(orgId, p);
    }
    await this.pendingEnsureOrg.get(orgId);
  }

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
