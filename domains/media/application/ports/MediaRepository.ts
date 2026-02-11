
import { PoolClient } from 'pg';

import { MediaAsset } from '../../domain/entities/MediaAsset';

/**
* Repository interface for MediaAsset persistence.
*
* This interface manages media file metadata and status tracking.
*
* @throws {RepositoryError} Implementations should throw domain-appropriate errors
*/
export interface MediaRepository {
  /**
  * Retrieve a media asset by its unique ID
  *
  * @param id - The unique identifier of the media asset
  * @returns Promise resolving to the media asset, or null if not found
  * @throws {Error} If database connection fails or other infrastructure error occurs
  */
  getById(id: string): Promise<MediaAsset | null>;

  /**
  * Save or update a media asset
  *
  * @param asset - The media asset to persist
  * @returns Promise resolving when save is complete
  * @throws {Error} If persistence operation fails
  */
  save(asset: MediaAsset): Promise<void>;

  /**
  * List media assets by status with pagination
  *
  * @param status - Filter by status
  * @param limit - Maximum number of results
  * @param offset - Pagination offset
  * @returns Promise resolving to array of media assets
  * @throws {Error} If query execution fails
  */
  listByStatus(status: 'pending' | 'uploaded', limit?: number, offset?: number): Promise<MediaAsset[]>;

  /**
  * Batch save multiple media assets
  * MEDIUM FIX M6: Added batch save support with result tracking
  *
  * @param assets - Array of media assets to save
  * @returns Promise resolving to batch operation result
  * @throws {Error} If persistence operation fails
  */
  batchSave(assets: MediaAsset[]): Promise<{ saved: number; failed: number; errors: string[] }>;

  /**
  * Delete a media asset
  *
  * @param id - The unique identifier of the media asset to delete
  * @returns Promise resolving when deletion is complete
  * @throws {Error} If deletion fails
  */
  delete(id: string): Promise<void>;

  /**
  * Close the repository connection
  * MEDIUM FIX M16: Added cleanup method
  *
  * @returns Promise resolving when connection is closed
  */
  close(): Promise<void>;
}

/**
* Custom error class for repository operations
*/
export class MediaRepositoryError extends Error {
  constructor(
  message: string,
  public readonly code: string,
  override readonly cause?: unknown
  ) {
  super(message);
  this["name"] = 'MediaRepositoryError';
  }
}
