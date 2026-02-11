/**
* MediaAsset Domain Entity
*
* Represents a media file in the system with a simple state machine:
* pending → uploaded.
*
* This entity is immutable - all state changes return new instances.
*
* @module domains/media/domain/entities/MediaAsset
*/

export type MediaStatus = 'pending' | 'uploaded';

/**
* MediaAsset - Immutable domain entity representing a media file
*
* State transitions:
*   pending → uploaded
*/
export class MediaAsset {
  private constructor(
  public readonly id: string,
  public readonly storageKey: string,
  public readonly mimeType: string,
  public readonly status: MediaStatus
  ) {}

  /**
  * Create a new pending media asset
  * @param id - Unique identifier for the media asset
  * @param storageKey - Storage location/path
  * @param mimeType - MIME type of the media
  * @returns New MediaAsset instance in pending status
  */
  static createPending(id: string, storageKey: string, mimeType: string): MediaAsset {
    // P1-FIX: Added input validation for entity creation
    if (!id || typeof id !== 'string' || id.length < 3) {
      throw new Error('MediaAsset requires a valid id (string with at least 3 characters)');
    }
    if (!storageKey || typeof storageKey !== 'string') {
      throw new Error('MediaAsset requires a valid storageKey');
    }
    if (!mimeType || typeof mimeType !== 'string') {
      throw new Error('MediaAsset requires a valid mimeType');
    }
    return new MediaAsset(id, storageKey, mimeType, 'pending');
  }

  /**
  * Reconstitute a media asset from persistence
  * @param id - Unique identifier
  * @param storageKey - Storage location/path
  * @param mimeType - MIME type
  * @param status - Current status
  * @returns New MediaAsset instance
  */
  static reconstitute(
  id: string,
  storageKey: string,
  mimeType: string,
  status: MediaStatus
  ): MediaAsset {
  return new MediaAsset(id, storageKey, mimeType, status);
  }

  /**
  * Mark asset as uploaded - returns new immutable instance
  * @returns New MediaAsset with 'uploaded' status
  * @throws Error if asset is not in 'pending' status
  */
  markUploaded(): MediaAsset {
  if (this["status"] !== 'pending') {
    throw new Error('Media already finalized');
  }
  return new MediaAsset(this["id"], this.storageKey, this.mimeType, 'uploaded');
  }

  /**
  * Check if asset is pending upload
  */
  isPending(): boolean {
  return this["status"] === 'pending';
  }

  /**
  * Check if asset has been uploaded
  */
  isUploaded(): boolean {
  return this["status"] === 'uploaded';
  }
}
