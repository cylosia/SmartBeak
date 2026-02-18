/**
* MediaAsset Domain Entity
*
* Represents a media file in the system with a simple state machine:
* pending → uploaded, and soft-deleted (deleted) from either state.
*
* This entity is immutable - all state changes return new instances.
*
* @module domains/media/domain/entities/MediaAsset
*/

// FIX(P1): Include 'deleted' in the union — it is a valid persistent DB state
// (enforced by chk_media_assets_status CHECK constraint). Previously 'deleted'
// assets reconstituted from the DB had a status that TypeScript said could never
// exist, causing misleading error messages and incorrect guard logic.
export type MediaStatus = 'pending' | 'uploaded' | 'deleted';

// FIX(P2): Centralise allowed status values for runtime validation in reconstitute()
const VALID_STATUSES: readonly MediaStatus[] = ['pending', 'uploaded', 'deleted'];

/**
* MediaAsset - Immutable domain entity representing a media file
*
* State transitions:
*   pending → uploaded
*   pending | uploaded → deleted (soft-delete via MediaLifecycleService)
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
  * Reconstitute a media asset from persistence.
  * FIX(P1): Apply the same validation as createPending. Without this, corrupt
  * DB rows (empty storageKey, invalid status) produce invalid domain objects
  * that pass TypeScript type checks but crash deep inside business logic.
  * TypeScript union types are erased at runtime — this guard is necessary.
  *
  * @param id - Unique identifier
  * @param storageKey - Storage location/path
  * @param mimeType - MIME type
  * @param status - Current status (must be a valid MediaStatus)
  * @returns New MediaAsset instance
  */
  static reconstitute(
    id: string,
    storageKey: string,
    mimeType: string,
    status: MediaStatus
  ): MediaAsset {
    if (!id || typeof id !== 'string') {
      throw new Error('MediaAsset.reconstitute: id must be a non-empty string');
    }
    if (!storageKey || typeof storageKey !== 'string') {
      throw new Error('MediaAsset.reconstitute: storageKey must be a non-empty string');
    }
    if (!mimeType || typeof mimeType !== 'string') {
      throw new Error('MediaAsset.reconstitute: mimeType must be a non-empty string');
    }
    // Runtime check: TypeScript erases the union type; a corrupt DB row with
    // e.g. status = 'corrupted_state' would silently produce an invalid entity.
    if (!VALID_STATUSES.includes(status)) {
      throw new Error(`MediaAsset.reconstitute: invalid status '${String(status)}'`);
    }
    return new MediaAsset(id, storageKey, mimeType, status);
  }

  /**
  * Mark asset as uploaded - returns new immutable instance
  * @returns New MediaAsset with 'uploaded' status
  * @throws Error if asset is not in 'pending' status
  */
  markUploaded(): MediaAsset {
    // FIX(P1): Distinguish 'deleted' state explicitly for clearer error messages.
    // Previously a deleted asset threw "Media already finalized" which obscured root cause.
    if (this.status === 'deleted') {
      throw new Error('Cannot upload a deleted media asset');
    }
    if (this.status !== 'pending') {
      throw new Error('Media already finalized');
    }
    // FIX(P2): Use named property access — these are explicitly declared readonly
    // properties, not index-signature types. Bracket notation was misleading.
    return new MediaAsset(this.id, this.storageKey, this.mimeType, 'uploaded');
  }

  /**
  * Check if asset is pending upload
  */
  isPending(): boolean {
    return this.status === 'pending';
  }

  /**
  * Check if asset has been uploaded
  */
  isUploaded(): boolean {
    return this.status === 'uploaded';
  }

  /**
  * FIX(P1): Check if asset has been soft-deleted.
  * Previously 'deleted' was not in the domain type, making it impossible to
  * distinguish deleted from active assets without inspecting raw DB status values.
  */
  isDeleted(): boolean {
    return this.status === 'deleted';
  }
}
