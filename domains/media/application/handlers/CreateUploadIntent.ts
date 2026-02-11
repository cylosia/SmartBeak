import { getLogger } from '@kernel/logger';

import { MediaAsset } from '../../domain/entities/MediaAsset';
import { MediaRepository } from '../ports/MediaRepository';

const logger = getLogger('CreateUploadIntent');

﻿

/**
* Result type for CreateUploadIntent command
*/
export interface CreateUploadIntentResult {
  success: boolean;
  asset?: MediaAsset;
  error?: string;
}

/**
* Command handler for creating a media upload intent.
*
* This handler creates a new pending media asset record that represents
* an intention to upload a file. The actual file upload happens separately,
* and is completed via the CompleteUpload handler.
*
* @throws Never throws - all errors are caught and returned in the result
*/
export class CreateUploadIntent {
  constructor(private readonly repo: MediaRepository) {}

  /**
  * Execute the create upload intent command
  *
  * @param id - Unique identifier for the media asset
  * @param storageKey - The storage location/path where the file will be stored
  * @param mimeType - MIME type of the intended upload (e.g., 'image/jpeg', 'video/mp4')
  * @returns Promise resolving to the result of the operation
  *
  * @example
  * ```typescript
  * const result = await handler.execute(
  *   'media-123',
  *   'uploads/2024/image.jpg',
  *   'image/jpeg'
  * );
  * if (result.success) {
  *   // Upload intent created successfully
  * } else {
  *   // Handle error: result.error
  * }
  * ```
  */
  async execute(
  id: string,
  storageKey: string,
  mimeType: string
  ): Promise<CreateUploadIntentResult> {
  // Input validation
  const validationError = this.validateInputs(id, storageKey, mimeType);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    // Check for duplicate ID
    const existingAsset = await this.repo.getById(id);
    if (existingAsset) {
    return {
    success: false,
    error: `Media asset with ID '${id}' already exists`
    };
    }

    const asset = MediaAsset.createPending(id, storageKey, mimeType);
    await this.repo.save(asset);

    return { success: true, asset };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to create upload intent'
    };
  }
  }

  /**
  * Validates all input parameters
  *
  * @param id - Media asset ID to validate
  * @param storageKey - Storage key to validate
  * @param mimeType - MIME type to validate
  * @returns Error message if validation fails, undefined otherwise
  */
  private validateInputs(
  id: string,
  storageKey: string,
  mimeType: string
  ): string | undefined {
  // Validate ID
  if (!id || typeof id !== 'string') {
    return 'Media asset ID is required and must be a string';
  }
  if (id.length < 1) {
    return 'Media asset ID cannot be empty';
  }

  // Validate storage key
  if (!storageKey || typeof storageKey !== 'string') {
    return 'Storage key is required and must be a string';
  }
  if (storageKey.length < 1) {
    return 'Storage key cannot be empty';
  }

  // Validate MIME type
  if (!mimeType || typeof mimeType !== 'string') {
    return 'MIME type is required and must be a string';
  }
  if (!this.isValidMimeType(mimeType)) {
    return `Invalid MIME type format: '${mimeType}'`;
  }

  return undefined;
  }

  /**
  * Validates MIME type format
  *
  * @param mimeType - MIME type string to validate
  * @returns True if the MIME type format is valid
  */
  private isValidMimeType(mimeType: string): boolean {
  // Basic MIME type validation: type/subtype format
  const mimeTypePattern = /^[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*$/;
  return mimeTypePattern.test(mimeType);
  }
}
