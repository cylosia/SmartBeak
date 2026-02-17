


import { Pool, PoolClient } from 'pg';

import { getLogger } from '@kernel/logger';
import { DB } from '@kernel/constants';

import { MediaAsset } from '../../domain/entities/MediaAsset';
import { MediaRepository } from '../../application/ports/MediaRepository';

const logger = getLogger('media:repository');

/**
* Repository implementation for MediaAsset using PostgreSQL
* */
export class PostgresMediaRepository implements MediaRepository {
  constructor(private pool: Pool) {}

  /**
  * Get media asset by ID
  * @param id - Media asset ID
  * @returns MediaAsset or null if not found
  */
  async getById(id: string, client?: PoolClient): Promise<MediaAsset | null> {
  // Validate input
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  try {
    const queryable = client || this.pool;
    const { rows } = await queryable.query(
    `SELECT id, storage_key, mime_type, status
    FROM media_assets
    WHERE id = $1`,
    [id]
    );

    if (!rows[0]) {
    return null;
    }

    const r = rows[0];
    // Use reconstitute for immutable entity creation
    return MediaAsset.reconstitute(r["id"], r.storage_key, r.mime_type, r["status"]);
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to get media asset by ID', err, { id });
    throw error;
  }
  }

  /**
  * Save a media asset
  * @param asset - MediaAsset to save
  */
  async save(asset: MediaAsset, client?: PoolClient): Promise<void> {
  // Validate input
  if (!asset || typeof asset["id"] !== 'string') {
    throw new Error('asset must have a valid id');
  }
  try {
    const queryable = client || this.pool;
    await queryable.query(
    `INSERT INTO media_assets (id, storage_key, mime_type, status)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (id)
    DO UPDATE SET status = $4`,
    [asset["id"], asset.storageKey, asset.mimeType, asset["status"]]
    );
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to save media asset', err, {
    id: asset["id"],
    storageKey: asset.storageKey
    });
    throw error;
  }
  }

  /**
  * List media assets by status with pagination
  * @param status - Filter by status
  * @param limit - Maximum number of results
  * @param offset - Pagination offset
  * @returns Array of MediaAsset
  */
  async listByStatus(
  status: 'pending' | 'uploaded',
  limit: number = 20,
  offset: number = 0,
  client?: PoolClient
  ): Promise<MediaAsset[]> {
  // Validate inputs
  if (!status || typeof status !== 'string') {
    throw new Error('status must be a valid string');
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('limit must be a positive integer');
  }
  if (!Number.isInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative integer');
  }
  // P0-CRITICAL FIX: Clamp limit and offset to prevent unbounded pagination
  const safeLimit = Math.min(Math.max(1, limit), 100);
  const safeOffset = Math.min(Math.max(0, offset), DB.MAX_OFFSET);

  try {
    const queryable = client || this.pool;
    const { rows } = await queryable.query(
    `SELECT id, storage_key, mime_type, status
    FROM media_assets
    WHERE status = $1
    ORDER BY created_at DESC
    LIMIT $2 OFFSET $3`,
    [status, safeLimit, safeOffset]
    );

    return rows.map(r => MediaAsset.reconstitute(r["id"], r.storage_key, r.mime_type, r["status"]));
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to list media assets by status', err, { status });
    throw error;
  }
  }

  /**
  * Batch save media assets for better performance
  * P1-FIX: Added optional client parameter for transaction support
  * @param assets - Array of MediaAsset to save
  * @param client - Optional client for transaction context
  * @returns Promise resolving to batch operation result
  */
  async batchSave(
    assets: MediaAsset[],
    client?: PoolClient
  ): Promise<{ saved: number; failed: number; errors: string[] }> {
  // Validate input
  if (!Array.isArray(assets)) {
    throw new Error('assets must be an array');
  }

  if (assets.length === 0) {
    return { saved: 0, failed: 0, errors: [] };
  }

  // Validate batch size limit
  const MAX_BATCH_SIZE = 1000;
  if (assets.length > MAX_BATCH_SIZE) {
    throw new Error(
    `Batch size ${assets.length} exceeds maximum allowed ${MAX_BATCH_SIZE}. ` +
    `Split into smaller batches.`
    );
  }

  // Limit chunk size for processing
  const BATCH_SIZE = 100;
  if (assets.length > BATCH_SIZE) {
    // P1-8 FIX: When no client is provided, acquire a single client with
    // BEGIN/COMMIT wrapping all chunks to ensure a single transaction boundary.
    if (!client) {
      const txClient = await this.pool.connect();
      try {
        await txClient.query('BEGIN');
        await txClient.query('SET LOCAL statement_timeout = $1', [60000]);
        const results = { saved: 0, failed: 0, errors: [] as string[] };
        for (let i = 0; i < assets.length; i += BATCH_SIZE) {
          const batch = assets.slice(i, i + BATCH_SIZE);
          const batchResult = await this.executeBatchSave(batch, txClient);
          results.saved += batchResult.saved;
          results.failed += batchResult.failed;
          results.errors.push(...batchResult.errors);
        }
        await txClient.query('COMMIT');
        return results;
      } catch (error: unknown) {
        try {
          await txClient.query('ROLLBACK');
        } catch (rollbackError) {
          logger.error('Batch save rollback failed', rollbackError as Error);
        }
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Failed to batch save media assets', err, { count: assets.length });
        return { saved: 0, failed: assets.length, errors: [err.message] };
      } finally {
        txClient.release();
      }
    }

    const results = { saved: 0, failed: 0, errors: [] as string[] };
    for (let i = 0; i < assets.length; i += BATCH_SIZE) {
    const batch = assets.slice(i, i + BATCH_SIZE);
    const batchResult = await this.batchSave(batch, client);
    results.saved += batchResult.saved;
    results.failed += batchResult.failed;
    results.errors.push(...batchResult.errors);
    }
    return results;
  }

  // P1-FIX: Use provided client or create new connection
  if (client) {
    return this.executeBatchSave(assets, client);
  }

  // P1-FIX: Wrap batch operation in transaction for atomicity
  const newClient = await this.pool.connect();
  try {
    await newClient.query('BEGIN');
    await newClient.query('SET LOCAL statement_timeout = $1', [60000]); // 60 seconds for batch
    const result = await this.executeBatchSave(assets, newClient);
    await newClient.query('COMMIT');
    return result;
  } catch (error: unknown) {
    try {
      await newClient.query('ROLLBACK');
    } catch (rollbackError) {
      logger.error('Batch save rollback failed', rollbackError as Error);
    }
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to batch save media assets', err, { count: assets.length });
    return { saved: 0, failed: assets.length, errors: [err.message] };
  } finally {
    newClient.release();
  }
  }

  /**
  * Internal batch save execution
  * P1-FIX: Separated for reuse with transaction context
  */
  private async executeBatchSave(
  assets: MediaAsset[],
  client: PoolClient
  ): Promise<{ saved: number; failed: number; errors: string[] }> {
  // Use unnest for efficient batch insert
  // P1-FIX: Update all fields on conflict, not just status
  await client.query(
    `INSERT INTO media_assets (id, storage_key, mime_type, status)
    SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[])
    ON CONFLICT (id)
    DO UPDATE SET
    storage_key = EXCLUDED.storage_key,
    mime_type = EXCLUDED.mime_type,
    status = EXCLUDED.status,
    updated_at = now()`,
    [
    assets.map(a => a["id"]),
    assets.map(a => a.storageKey),
    assets.map(a => a.mimeType),
    assets.map(a => a["status"])
    ]
  );

  return { saved: assets.length, failed: 0, errors: [] };
  }

  /**
  * Delete a media asset
  * @param id - Media asset ID to delete
  */
  async delete(id: string, client?: PoolClient): Promise<void> {
  // Validate input
  if (!id || typeof id !== 'string') {
    throw new Error('id must be a non-empty string');
  }
  try {
    const queryable = client || this.pool;
    await queryable.query(
    'DELETE FROM media_assets WHERE id = $1',
    [id]
    );
  } catch (error: unknown) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Failed to delete media asset', err, { id });
    throw error;
  }
  }

  /**
  * Clean up repository resources
  * Note: Pool is shared and managed externally, no-op here
  */
  async close(): Promise<void> {
  // No-op: Repository doesn't own the pool connection
  // Pool lifecycle is managed by the dependency injection container
  }
}
