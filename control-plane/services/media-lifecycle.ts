
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
 * P2-4 FIX: Validate inputs as positive numbers
 */
function validatePositiveNumber(val: unknown, name: string): number {
  const num = Number(val);
  if (!Number.isFinite(num) || num < 0) {
    throw new Error(`${name} must be a non-negative number`);
  }
  return num;
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
   */
  async getHotCount(): Promise<number> {
    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM media_assets
       WHERE storage_class = 'hot' AND status != 'deleted'`
    );
    return Number(rows[0]?.['count'] ?? 0);
  }

  /**
   * Count cold candidates without loading all IDs into memory.
   * P2-6 FIX: Use Number() instead of parseInt().
   */
  async countColdCandidates(days: number): Promise<number> {
    const safeDays = validatePositiveNumber(days, 'days');

    const { rows } = await this.pool.query(
      `SELECT COUNT(*)::int AS count FROM media_assets
       WHERE storage_class = 'hot'
         AND status != 'deleted'
         AND COALESCE(last_accessed_at, created_at) < NOW() - make_interval(days => $1::int)`,
      [safeDays]
    );
    return Number(rows[0]?.['count'] ?? 0);
  }

  /**
   * Find cold media candidates.
   * P2-5 FIX: Add deterministic ORDER BY.
   */
  async findColdCandidates(days: number, limit: number = DEFAULT_QUERY_LIMIT): Promise<string[]> {
    const safeDays = validatePositiveNumber(days, 'days');
    const safeLimit = Math.min(Math.max(1, limit), DEFAULT_QUERY_LIMIT);

    const { rows } = await this.pool.query(
      `SELECT id FROM media_assets
       WHERE storage_class = 'hot'
         AND status != 'deleted'
         AND COALESCE(last_accessed_at, created_at) < NOW() - make_interval(days => $1::int)
       ORDER BY COALESCE(last_accessed_at, created_at) ASC
       LIMIT $2`,
      [safeDays, safeLimit]
    );
    return rows.map((r: Record<string, unknown>) => r['id'] as string);
  }

  /**
   * Transition media assets to cold storage.
   * P1-17 FIX: Requires org_id for tenant scoping.
   * P2-4 FIX: Return count of rows updated.
   */
  async markCold(ids: string[], orgId: string): Promise<number> {
    validateOrgId(orgId);
    if (!Array.isArray(ids) || ids.length === 0) return 0;

    const result = await this.pool.query(
      `UPDATE media_assets
       SET storage_class = 'cold', last_accessed_at = NOW()
       WHERE id = ANY($1) AND org_id = $2 AND status != 'deleted'`,
      [ids, orgId]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Find orphaned media assets (not linked to any content).
   * P2-5 FIX: Add deterministic ORDER BY.
   */
  async findOrphaned(days: number, limit: number = DEFAULT_QUERY_LIMIT): Promise<string[]> {
    const safeDays = validatePositiveNumber(days, 'days');
    const safeLimit = Math.min(Math.max(1, limit), DEFAULT_QUERY_LIMIT);

    const { rows } = await this.pool.query(
      `SELECT ma.id FROM media_assets ma
       WHERE ma.status = 'uploaded'
         AND ma.created_at < NOW() - make_interval(days => $1::int)
         AND NOT EXISTS (
           SELECT 1 FROM content_media_links cml
           WHERE cml.media_id = ma.id
         )
       ORDER BY ma.created_at ASC
       LIMIT $2`,
      [safeDays, safeLimit]
    );
    return rows.map((r: Record<string, unknown>) => r['id'] as string);
  }

  /**
   * Soft-delete media assets.
   * P1-17 FIX: Requires org_id for tenant scoping.
   * P1-18 FIX: Use soft-delete instead of hard DELETE.
   */
  async delete(ids: string[], orgId: string): Promise<number> {
    validateOrgId(orgId);
    if (!Array.isArray(ids) || ids.length === 0) return 0;

    const result = await this.pool.query(
      `UPDATE media_assets
       SET status = 'deleted', updated_at = NOW()
       WHERE id = ANY($1) AND org_id = $2 AND status != 'deleted'`,
      [ids, orgId]
    );
    return result.rowCount ?? 0;
  }

  /**
   * Find media assets by storage class.
   * P2-5 FIX: Add ORDER BY clause.
   */
  async findByStorageClass(
    storageClass: 'hot' | 'cold' | 'frozen',
    limit: number = DEFAULT_QUERY_LIMIT
  ): Promise<MediaAsset[]> {
    const safeLimit = Math.min(Math.max(1, limit), DEFAULT_QUERY_LIMIT);

    const { rows } = await this.pool.query(
      `SELECT id, org_id, size_bytes, created_at, last_accessed_at, storage_class, status
       FROM media_assets
       WHERE storage_class = $1 AND status != 'deleted'
       ORDER BY created_at DESC
       LIMIT $2`,
      [storageClass, safeLimit]
    );
    return rows as MediaAsset[];
  }

  /**
   * Get total storage used by organization.
   * P2-6 FIX: Use Number() instead of parseInt().
   */
  async getStorageUsed(orgId: string): Promise<number> {
    validateOrgId(orgId);

    const { rows } = await this.pool.query(
      `SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total
       FROM media_assets
       WHERE org_id = $1 AND status != 'deleted'`,
      [orgId]
    );
    return Number(rows[0]?.['total'] ?? 0);
  }
}
