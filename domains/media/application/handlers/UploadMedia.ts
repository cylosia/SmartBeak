import { getLogger } from '@kernel/logger';

import { MediaAsset } from '../../domain/entities/MediaAsset';
import { MediaRepository } from '../ports/MediaRepository';
import { MediaUploaded } from '../../domain/events/MediaUploaded';

const _logger = getLogger('UploadMedia');



/**
* Result type for UploadMedia command
*/
export interface UploadMediaResult {
  success: boolean;
  asset?: MediaAsset;
  event?: ReturnType<MediaUploaded['toEnvelope']>;
  error?: string;
}

/**
* Command handler for uploading media.
*
* This handler creates a new media asset record for an uploaded file.
* It validates inputs, sanitizes the storage key, and validates URL format
* for security.
*
* @throws Never throws - all errors are caught and returned in the result
*/
export class UploadMedia {
  constructor(private readonly repo: MediaRepository) {}

  /**
  * Execute the upload media command
  *
  * @param id - Unique identifier for the media asset
  * @param storageKey - Storage location/path where the file is stored
  * @param mimeType - MIME type of the uploaded file
  * @returns Promise resolving to the result of the operation
  *
  * @example
  * ```typescript
  * const result = await handler.execute('media-123', 'uploads/image.jpg', 'image/jpeg');
  * if (result.success) {
  *   // Media uploaded successfully
  * } else {
  *   // Handle error: result.error
  * }
  * ```
  */
  async execute(
  id: string,
  storageKey: string,
  mimeType: string
  ): Promise<UploadMediaResult> {
  // Input validation
  const validationError = this.validateInputs(id, storageKey, mimeType);
  if (validationError) {
    return { success: false, error: validationError };
  }

  // Security: Sanitize storage key to prevent path traversal
  const sanitizedKey = this.sanitizeStorageKey(storageKey);
  if (!sanitizedKey) {
    return { success: false, error: 'Invalid storage key format' };
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

    // Create media asset directly as uploaded
    const asset = MediaAsset.reconstitute(id, sanitizedKey, mimeType, 'uploaded');
    await this.repo.save(asset);

    // Generate domain event
    const event = new MediaUploaded().toEnvelope(id);

    return { success: true, asset, event };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to upload media'
    };
  }
  }

  /**
  * Validates input parameters
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
  if (id.length < 1 || id.length > 255) {
    return 'Media asset ID must be between 1 and 255 characters';
  }

  // Validate storage key
  if (!storageKey || typeof storageKey !== 'string') {
    return 'Storage key is required and must be a string';
  }
  if (storageKey.length < 1 || storageKey.length > 2048) {
    return 'Storage key must be between 1 and 2048 characters';
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
  * Sanitizes storage key to prevent path traversal attacks
  *
  * @param key - Raw storage key
  * @returns Sanitized storage key or null if invalid
  */
  private sanitizeStorageKey(key: string): string | null {
  // Remove null bytes
  let sanitized = key.replace(/\0/g, '');

  // Normalize path separators
  sanitized = sanitized.replace(/\\/g, '/');

  // Prevent path traversal: remove '../' and './' patterns
  const pathTraversalPattern = /\.\.\//g;
  if (pathTraversalPattern.test(sanitized)) {
    return null;
  }

  // Remove leading slashes for security
  sanitized = sanitized.replace(/^[/]+/, '');

  // Security: Only allow safe characters
  const safePattern = /^[a-zA-Z0-9_\-./]+$/;
  if (!safePattern.test(sanitized)) {
    return null;
  }

  // Ensure key is not empty after sanitization
  if (sanitized.length === 0) {
    return null;
  }

  return sanitized;
  }

  /**
  * Validates MIME type format
  *
  * @param mimeType - MIME type string to validate
  * @returns True if the MIME type format is valid
  */
  private isValidMimeType(mimeType: string): boolean {
  // Security: Strict MIME type validation
  const mimeTypePattern = /^[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*\/[a-zA-Z0-9][a-zA-Z0-9!#$&\-^_.+]*$/;
  if (!mimeTypePattern.test(mimeType)) {
    return false;
  }

  // Security: Block potentially dangerous MIME types
  const blockedTypes = [
    'application/x-javascript',
    'text/javascript',
    'application/javascript',
    'application/ecmascript',
    'text/ecmascript',
    'application/x-php',
    'application/x-sh',
    'application/x-csh',
    'application/x-executable'
  ];

  return !blockedTypes.includes(mimeType.toLowerCase());
  }
}
