
import { Pool } from 'pg';

// P2-11 FIX: Removed unused UUID_REGEX constant (was duplicated inline at getStorageUsed)

export interface MediaAsset {
  id: string;
  org_id: string;
  size_bytes: number;
  created_at: Date;
  last_accessed_at: Date | null;
}

/** Default query limit to prevent unbounded result sets (P2-2 FIX) */
const DEFAULT_QUERY_LIMIT = 10000;

export class MediaLifecycleService {
  constructor(private pool: Pool) {}

  async markAccessed(mediaId: string): Promise<void> {
  if (!mediaId || typeof mediaId !== 'string') {
    throw new Error('Valid mediaId is required');
  }

  await this.pool.query(
    `UPDATE media_assets SET last_accessed_at = NOW() WHERE id = $1`,
    [mediaId]
  );
  }

  /**
  * P0-2 FIX: Added getHotCount() method.
  * Previously missing, causing runtime crash when called via
  * the media-lifecycle route's IMediaLifecycleService cast.
  */
  async getHotCount(): Promise<number> {
  const { rows } = await this.pool.query(
    `SELECT COUNT(*)::int as count FROM media_assets WHERE storage_class = 'hot'`
  );
  return rows[0]?.count ?? 0;
  }

  /**
  * P2-1 FIX: Count cold candidates without loading all IDs into memory.
  */
  async countColdCandidates(days: number): Promise<number> {
  if (typeof days !== 'number' || days < 0) {
    throw new Error('Days must be a non-negative number');
  }

  const { rows } = await this.pool.query(
    `SELECT COUNT(*)::int as count FROM media_assets
    WHERE storage_class = 'hot'
    AND COALESCE(last_accessed_at, created_at) < NOW() - make_interval(days => $1::int)`,
    [days]
  );
  return rows[0]?.count ?? 0;
  }

  /**
  * Find cold media candidates
  * Uses parameterized queries with proper interval syntax
  * P2-2 FIX: Added LIMIT parameter to prevent unbounded result sets
  */
  async findColdCandidates(days: number, limit: number = DEFAULT_QUERY_LIMIT): Promise<string[]> {
  if (typeof days !== 'number' || days < 0) {
    throw new Error('Days must be a non-negative number');
  }

  const safeLimit = Math.min(Math.max(1, limit), DEFAULT_QUERY_LIMIT);

  const { rows } = await this.pool.query(
    `SELECT id FROM media_assets
    WHERE storage_class = 'hot'
    AND COALESCE(last_accessed_at, created_at) < NOW() - make_interval(days => $1::int)
    LIMIT $2`,
    [days, safeLimit]
  );
  return rows.map((r: { id: string }) => r["id"]);
  }

  async markCold(mediaId: string): Promise<void> {
  if (!mediaId || typeof mediaId !== 'string') {
    throw new Error('Valid mediaId is required');
  }

  await this.pool.query(
    `UPDATE media_assets SET storage_class = 'cold' WHERE id = $1`,
    [mediaId]
  );
  }

  /**
  * Find orphaned media assets
  * P2-2 FIX: Added LIMIT parameter to prevent unbounded result sets
  */
  async findOrphaned(days: number, limit: number = DEFAULT_QUERY_LIMIT): Promise<string[]> {
  if (typeof days !== 'number' || days < 0) {
    throw new Error('Days must be a non-negative number');
  }

  const safeLimit = Math.min(Math.max(1, limit), DEFAULT_QUERY_LIMIT);

  const { rows } = await this.pool.query(
    `SELECT ma.id FROM media_assets ma
    WHERE ma.status = 'uploaded'
    AND ma.created_at < NOW() - make_interval(days => $1::int)
    AND NOT EXISTS (
    SELECT 1 FROM content_media_links cml
    WHERE cml.media_id = ma.id
    )
    LIMIT $2`,
    [days, safeLimit]
  );
  return rows.map((r: { id: string }) => r["id"]);
  }

  async delete(mediaId: string): Promise<void> {
  if (!mediaId || typeof mediaId !== 'string') {
    throw new Error('Valid mediaId is required');
  }

  await this.pool.query(
    `DELETE FROM media_assets WHERE id = $1`,
    [mediaId]
  );
  }

  /**
  * Find media assets by storage class
  * P2-2 FIX: Added LIMIT parameter to prevent unbounded result sets
  */
  async findByStorageClass(storageClass: 'hot' | 'cold' | 'frozen', limit: number = DEFAULT_QUERY_LIMIT): Promise<MediaAsset[]> {
  const safeLimit = Math.min(Math.max(1, limit), DEFAULT_QUERY_LIMIT);

  const { rows } = await this.pool.query(
    `SELECT id, org_id, size_bytes, created_at, last_accessed_at
    FROM media_assets
    WHERE storage_class = $1
    LIMIT $2`,
    [storageClass, safeLimit]
  );
  return rows;
  }

  /**
  * Get total storage used by organization
  */
  async getStorageUsed(orgId: string): Promise<number> {
  if (!orgId || typeof orgId !== 'string') {
    throw new Error('Valid orgId is required');
  }

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(orgId)) {
    throw new Error('Invalid orgId format: must be a valid UUID');
  }

  const { rows } = await this.pool.query(
    `SELECT COALESCE(SUM(size_bytes), 0) as total
    FROM media_assets
    WHERE org_id = $1 AND status != 'deleted'`,
    [orgId]
  );
  // P2-4 FIX: Added null check for rows[0]
  return parseInt(rows[0]?.total ?? '0', 10);
  }
}
