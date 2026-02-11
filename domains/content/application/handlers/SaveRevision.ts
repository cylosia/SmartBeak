

import { randomUUID } from 'crypto';

import { getLogger } from '@kernel/logger';

import { ContentItem } from '../../domain/entities/ContentItem';
import { ContentRevision } from '../../domain/entities/ContentRevision';
import { ContentRevisionRepository } from '../ports/ContentRevisionRepository';

const logger = getLogger('save-revision');

/**
* Result type for SaveRevision command
*/
export interface SaveRevisionResult {
  success: boolean;
  revision?: ContentRevision;
  error?: string;
}

/**
* Command handler for saving a content revision.
*
* This handler creates a new revision snapshot of a content item,
* saves it to the repository, and prunes old revisions to maintain
* a limited history.
*
* @throws Never throws - all errors are caught and returned in the result
*/
export class SaveRevision {
  // Performance: Default maximum revisions to keep per content item
  private static readonly DEFAULT_KEEP_LAST = 20;
  private static readonly MAX_KEEP_LAST = 100;

  constructor(
  private readonly revisions: ContentRevisionRepository,
  private readonly keepLast: number = SaveRevision.DEFAULT_KEEP_LAST
  ) {
  // Performance: Validate and clamp keepLast to reasonable bounds
  if (keepLast < 1 || keepLast > SaveRevision.MAX_KEEP_LAST) {
    this.keepLast = SaveRevision.DEFAULT_KEEP_LAST;
  }
  }

  /**
  * Execute the save revision command
  *
  * @param item - The content item to create a revision for
  * @returns Promise resolving to the result of the operation
  *
  * @example
  * ```typescript
  * const contentItem = await contentRepo.getById('content-123');
  * const result = await handler.execute(contentItem);
  * if (result.success) {
  *   // Revision saved successfully
  * } else {
  *   // Handle error: result.error
  * }
  * ```
  */
  async execute(item: ContentItem): Promise<SaveRevisionResult> {
  // Input validation
  const validationError = this.validateInput(item);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    // Create new revision
    const rev = ContentRevision.create(
    randomUUID(),
    item["id"],
    item["title"],
    item["body"],
    new Date()
    );

    // Save revision
    await this.revisions.add(rev);

    // Performance: Prune old revisions asynchronously (don't block response)
    this.pruneRevisions(item["id"]).catch(err => {
    logger.error('Failed to prune revisions:', err instanceof Error ? err : new Error(String(err)));
    });

    return { success: true, revision: rev };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to save revision'
    };
  }
  }

  /**
  * Validates the input content item
  *
  * @param item - Content item to validate
  * @returns Error message if validation fails, undefined otherwise
  */
  private validateInput(item: ContentItem): string | undefined {
  if (!item) {
    return 'Content item is required';
  }
  if (!item["id"] || typeof item["id"] !== 'string') {
    return 'Content item must have a valid ID';
  }
  return undefined;
  }

  /**
  * Prune old revisions to maintain performance
  * @param contentId - ID of the content item
  */
  private async pruneRevisions(contentId: string): Promise<void> {
  try {
    await this.revisions.prune(contentId, this.keepLast);
  } catch (error) {
    // Log but don't throw - this is a background cleanup operation
    logger.error('Error pruning revisions:', error instanceof Error ? error : new Error(String(error)));
  }
  }
}
