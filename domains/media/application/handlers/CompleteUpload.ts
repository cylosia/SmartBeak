import { DomainEventEnvelope } from '../../../../packages/types/domain-event';

import { MediaAsset } from '../../domain/entities/MediaAsset';
import { MediaRepository } from '../ports/MediaRepository';
import { MediaUploadCompleted } from '../../domain/events/MediaUploadCompleted';
import { MediaUploadCompletedPayload } from '../../domain/events/MediaUploadCompleted';




/**
* Result type for CompleteUpload command
*/
export interface CompleteUploadResult {
  success: boolean;
  asset?: MediaAsset;
  event?: DomainEventEnvelope<string, MediaUploadCompletedPayload>;
  error?: string;
}

/**
* Command handler for completing a media upload.
*
* This handler finalizes the upload process by marking a pending media asset
* as uploaded and generating a domain event to notify other parts of the system.
*
* @throws Never throws - all errors are caught and returned in the result
*/
export class CompleteUpload {
  constructor(private readonly repo: MediaRepository) {}

  /**
  * Execute the complete upload command
  *
  * @param id - The unique identifier of the media asset
  * @returns Promise resolving to the result of the operation
  *
  * @example
  * ```typescript
  * const result = await handler.execute('media-123');
  * if (result.success) {
  *   // Upload completed successfully
  * } else {
  *   // Handle error: result.error
  * }
  * ```
  */
  async execute(id: string): Promise<CompleteUploadResult> {
  // Input validation
  const validationError = this.validateInput(id);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    // Fetch the media asset
    const asset = await this.repo.getById(id);

    // Handle not found case
    if (!asset) {
    return {
    success: false,
    error: `Media asset with ID '${id}' not found`
    };
    }

    // Validate asset state before marking as uploaded
    const stateValidationError = this.validateAssetState(asset);
    if (stateValidationError) {
    return { success: false, error: stateValidationError };
    }

    // Mark as uploaded (immutable - returns new instance)
    const updatedAsset = asset.markUploaded();

    // Persist the updated asset
    await this.repo.save(updatedAsset);

    // Generate domain event
    const event = new MediaUploadCompleted().toEnvelope(id);

    return { success: true, asset: updatedAsset, event };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to complete upload'
    };
  }
  }

  /**
  * Validates the input ID
  *
  * @param id - Media asset ID to validate
  * @returns Error message if validation fails, undefined otherwise
  */
  private validateInput(id: string): string | undefined {
  if (!id || typeof id !== 'string') {
    return 'Media asset ID is required and must be a string';
  }
  if (id.length < 1) {
    return 'Media asset ID cannot be empty';
  }
  return undefined;
  }

  /**
  * Validates the asset state before completing upload
  *
  * @param asset - The media asset to validate
  * @returns Error message if validation fails, undefined otherwise
  */
  private validateAssetState(asset: MediaAsset): string | undefined {
  if (!asset.isPending()) {
    return `Cannot complete upload: media asset is in '${asset["status"]}' state (expected 'pending')`;
  }
  return undefined;
  }
}
