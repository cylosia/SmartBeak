
import { Pool } from 'pg';
import { getLogger } from '@kernel/logger';

const logger = getLogger('MediaLifecycleService');

// P2-2 FIX: Use DEFAULT_QUERY_LIMIT to prevent unbounded result sets
const DEFAULT_QUERY_LIMIT = 10000;

// P2-5 FIX: Validate org_id format
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateOrgId(orgId: string): void {
  if (!orgId || typeof orgId !== 'string' || !UUID_REGEX.test(orgId)) {
    throw new Error('Invalid orgId format: must be a valid UUID');
  }
}

/**
 * P2-4 FIX: Validate inputs as strictly positive numbers (> 0).
 * Zero is rejected: days=0 resolves to < NOW() which selects the ENTIRE hot
 * corpus as cold candidates, triggering a mass lifecycle transition.
 */
function validatePositiveNumber(val: unknown, name: string): number {
  const num = Number(val);
  if (!Number.isFinite(num) || num <= 0) {
    throw new Error(`${name} must be a positive number greater than zero`);
  }
  return num;
}

/**
 * FIX(P2): Validate that each ID in a bulk array is a properly-formed UUID.
 * Without this, nulls or garbage strings from the caller propagate into ANY($1)
 * and corrupt audit logs even though they silently match nothing in the DB.
 */
function validateIdArray(ids: string[], name: string): void {
  for (const id of ids) {
    if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
      throw new Error(`${name} contains invalid UUID: ${String(id)}`);
    }
  }
}

export interface MediaAsset {
  id: string;
  org_id: string;
  size_bytes: number;
  created_at: Date;
  last_accessed_at: Date | null;
  storage_class: string;
  status: string;
}

/**
 * Media lifecycle service
 * Manages storage class transitions, orphan detection, and storage usage.
 *
 * P1-17 FIX: All mutation queries now require and scope by org_id.
 * P1-18 FIX: Use soft-delete (status='deleted') instead of hard DELETE.
 * P2-4 FIX: Check rowCount on mutations to detect missing rows.
 * P2-5 FIX: Add ORDER BY to all queries returning multiple rows.
 * P2-6 FIX: Use Number() instead of parseInt() for numeric conversion.
 */
export class MediaLifecycleService {
  constructor(private pool: Pool) {}

  /**
   * Mark a media asset as recently accessed (resets cold-storage timer).
   * P1-17 FIX: Requires org_id for tenant scoping.
   * P2-4 FIX: Check rowCount and return boolean.
   */
  async markAccessed(id: string, orgId: string): Promise<boolean> {
    validateOrgId(orgId);
    if (!id || typeof id !== 'string') throw new Error('Valid mediaId is required');

    const result = await this.pool.query(
      `UPDATE media_assets SET last_accessed_at = NOW()
       WHERE id = $1 AND org_id = $2 AND status != 'deleted'`,
      [id, orgId]
    );
    const changed = (result.rowCount ?? 0) > 0;
    if (!changed) {
      logger.warn('markAccessed: no rows updated', { id, orgId });
    }
    return changed;
  }

  /**
   * Get count of "hot" (recently-accessed) media assets.
   * FIX(P0): Require orgId to prevent cross-tenant data leakage. Previously
   * this method returned an aggregate spanning ALL tenants.
   */
  async getHotCount(orgId: string): Promise<number> {
    validateOrgId(orgId);
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM media_assets
       WHERE storage_class = 'hot' AND status != 'deleted' AND org_id = $1`,
      [orgId]
    );
    return Number(rows[0]?.['count'] ?? 0);
  }

  /**
   * Count cold candidates for a specific org without loading all IDs into memory.
   * P0-FIX: Added required orgId parameter to prevent cross-tenant data leakage.
   * Previously this method ran an aggregate across ALL tenants and exposed the
   * result in the /admin/media/lifecycle API response.
   * P2-6 FIX: Use Number() instead of parseInt().
   */
  async countColdCandidates(days: number, orgId: string): Promise<number> {
    validateOrgId(orgId);
    const safeDays = validatePositiveNumber(days, 'days');

    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM media_assets
       WHERE storage_class = 'hot'
         AND status != 'deleted'
         AND org_id = $2
         AND COALESCE(last_accessed_at, created_at) < NOW() - make_interval(days => $1::int)`,
      [safeDays, orgId]
    );
    return Number(rows[0]?.['count'] ?? 0);
  }

  /**
   * Find cold media candidates for a specific org.
   * P0-FIX: Added required orgId parameter to prevent cross-tenant data leakage.
   * Without org scoping, a lifecycle job calling this method would receive asset
   * IDs from ALL tenants and feed them into per-org mutation calls, corrupting
   * other tenants' storage classifications.
   * P2-5 FIX: Add deterministic ORDER BY.
   * FIX(P2): Validate that extracted IDs are non-null strings before returning.
   */
  async findColdCandidates(days: number, orgId: string, limit: number = DEFAULT_QUERY_LIMIT): Promise<string[]> {
    validateOrgId(orgId);
    const safeDays = validatePositiveNumber(days, 'days');
    const safeLimit = Math.min(Math.max(1, limit), DEFAULT_QUERY_LIMIT);

    const { rows } = await this.pool.query(
      `SELECT id FROM media_assets
       WHERE storage_class = 'hot'
         AND status != 'deleted'
         AND org_id = $2
         AND COALESCE(last_accessed_at, created_at) < NOW() - make_interval(days => $1::int)
       ORDER BY COALESCE(last_accessed_at, created_at) ASC
       LIMIT $3`,
      [safeDays, orgId, safeLimit]
    );
    return rows.map((r: Record<string, unknown>) => {
      const id = r['id'];
      if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
        throw new Error(`Invalid UUID returned from DB: ${String(id)}`);
      }
      return id;
    });
  }

  /**
   * Transition media assets to cold storage.
   * P1-17 FIX: Requires org_id for tenant scoping.
   * P2-4 FIX: Return count of rows updated.
   * FIX(P1): Enforce array size cap and per-element UUID validation.
   */
  async markCold(ids: string[], orgId: string): Promise<number> {
    validateOrgId(orgId);
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    // FIX(P1): Unbounded ANY($1) arrays OOM the PostgreSQL backend
    if (ids.length > DEFAULT_QUERY_LIMIT) {
      throw new Error(`markCold: ids array exceeds maximum size of ${DEFAULT_QUERY_LIMIT}`);
    }
    // FIX(P2): Validate each element — garbage IDs pollute audit logs
    validateIdArray(ids, 'ids');

    // P1-FIX: Removed `last_accessed_at = NOW()` — that column records when the
    // asset was *accessed*, not when it was reclassified.  Setting it here would
    // reset the cold-candidate clock immediately after a cold transition, so a
    // subsequent findColdCandidates call would never see these assets again,
    // corrupting the access-history audit trail.
    const result = await this.pool.query(
      `UPDATE media_assets
       SET storage_class = 'cold'
       WHERE id = ANY($1) AND org_id = $2 AND status != 'deleted'`,
      [ids, orgId]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Find orphaned media assets (not linked to any content).
   * P2-5 FIX: Add deterministic ORDER BY.
   * FIX(P0): Require orgId — previously scanned ALL tenants' assets.
   */
  async findOrphaned(orgId: string, days: number, limit: number = DEFAULT_QUERY_LIMIT): Promise<string[]> {
    validateOrgId(orgId);
    const safeDays = validatePositiveNumber(days, 'days');
    const safeLimit = Math.min(Math.max(1, limit), DEFAULT_QUERY_LIMIT);

    const { rows } = await this.pool.query(
      `SELECT ma.id FROM media_assets ma
       WHERE ma.status = 'uploaded'
         AND ma.org_id = $1
         AND ma.created_at < NOW() - make_interval(days => $2::int)
         AND NOT EXISTS (
           SELECT 1 FROM content_media_links cml
           WHERE cml.media_id = ma.id
         )
       ORDER BY ma.created_at ASC
       LIMIT $3`,
      [orgId, safeDays, safeLimit]
    );
    return rows.map((r: Record<string, unknown>) => {
      const id = r['id'];
      if (typeof id !== 'string' || !UUID_REGEX.test(id)) {
        throw new Error(`Invalid UUID returned from DB: ${String(id)}`);
      }
      return id;
    });
  }

  /**
   * Soft-delete media assets.
   * P1-17 FIX: Requires org_id for tenant scoping.
   * P1-18 FIX: Use soft-delete instead of hard DELETE.
   * FIX(P1): Enforce array size cap and per-element UUID validation.
   */
  async delete(ids: string[], orgId: string): Promise<number> {
    validateOrgId(orgId);
    if (!Array.isArray(ids) || ids.length === 0) return 0;
    // FIX(P1): Unbounded ANY($1) arrays OOM the PostgreSQL backend
    if (ids.length > DEFAULT_QUERY_LIMIT) {
      throw new Error(`delete: ids array exceeds maximum size of ${DEFAULT_QUERY_LIMIT}`);
    }
    // FIX(P2): Validate each element
    validateIdArray(ids, 'ids');

    // P1-FIX: Added `deleted_at = NOW()` to populate the audit timestamp.
    // Previously deleted_at was always NULL, making GDPR data-retention sweeps,
    // compliance queries (WHERE deleted_at < NOW() - interval '90 days'), and
    // audit reports based on deletion time completely non-functional.
    const result = await this.pool.query(
      `UPDATE media_assets
       SET status = 'deleted', updated_at = NOW(), deleted_at = NOW()
       WHERE id = ANY($1) AND org_id = $2 AND status != 'deleted'`,
      [ids, orgId]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Find media assets by storage class.
   * P2-5 FIX: Add ORDER BY clause.
   * FIX(P0): Require orgId — previously returned cross-tenant asset lists.
   */
  async findByStorageClass(
    storageClass: 'hot' | 'cold' | 'frozen',
    orgId: string,
    limit: number = DEFAULT_QUERY_LIMIT
  ): Promise<MediaAsset[]> {
    validateOrgId(orgId);
    const safeLimit = Math.min(Math.max(1, limit), DEFAULT_QUERY_LIMIT);

    const { rows } = await this.pool.query(
      `SELECT id, org_id, size_bytes, created_at, last_accessed_at, storage_class, status
       FROM media_assets
       WHERE storage_class = $1 AND org_id = $2 AND status != 'deleted'
       ORDER BY created_at DESC
       LIMIT $3`,
      [storageClass, orgId, safeLimit]
    );
    // The local MediaAsset is an interface (plain object shape), not the domain
    // entity class. The pg rows satisfy this interface directly.
    return rows as MediaAsset[];
  }

  /**
   * Get total storage used by organization.
   * FIX(P1): PostgreSQL returns bigint SUM as a string via the pg driver to
   * avoid JS number precision loss (Number.MAX_SAFE_INTEGER ≈ 9PB). We return
   * bigint so callers can handle large orgs correctly. Callers doing arithmetic
   * must use BigInt operations.
   */
  async getStorageUsed(orgId: string): Promise<bigint> {
    validateOrgId(orgId);

    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total
       FROM media_assets
       WHERE org_id = $1 AND status != 'deleted'`,
      [orgId]
    );
    // The pg driver returns bigint columns as strings to preserve precision
    return BigInt(String(rows[0]?.['total'] ?? 0));
  }
}
