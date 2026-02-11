
import { Pool } from 'pg';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface MediaAsset {
  id: string;
  org_id: string;
  size_bytes: number;
  created_at: Date;
  last_accessed_at: Date | null;
}

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
  * Find cold media candidates
  * Uses parameterized queries with proper interval syntax
  */
  async findColdCandidates(days: number): Promise<string[]> {
  if (typeof days !== 'number' || days < 0) {
    throw new Error('Days must be a non-negative number');
  }

  const { rows } = await this.pool.query(
    `SELECT id FROM media_assets
    WHERE storage_class = 'hot'
    AND COALESCE(last_accessed_at, created_at) < NOW() - make_interval(days => $1::int)`,
    [days]
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
  */
  async findOrphaned(days: number): Promise<string[]> {
  if (typeof days !== 'number' || days < 0) {
    throw new Error('Days must be a non-negative number');
  }

  // NOT IN with subqueries can be slow with large datasets
  const { rows } = await this.pool.query(
    `SELECT ma["id"] FROM media_assets ma
    WHERE ma.status = 'uploaded'
    AND ma.created_at < NOW() - make_interval(days => $1::int)
    AND NOT EXISTS (
    SELECT 1 FROM content_media_links cml
    WHERE cml.media_id = ma["id"]
    )`,
    [days]
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
  */
  async findByStorageClass(storageClass: 'hot' | 'cold' | 'frozen'): Promise<MediaAsset[]> {
  const { rows } = await this.pool.query(
    `SELECT id, org_id, size_bytes, created_at, last_accessed_at
    FROM media_assets
    WHERE storage_class = $1`,
    [storageClass]
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
  return parseInt(rows[0].total, 10);
  }
}
