import { getLogger } from '@kernel/logger';

import { ContentItem } from '../../domain/entities/ContentItem';
import { ContentPublished } from '../../domain/events/ContentPublished';
import { ContentRepository } from '../ports/ContentRepository';

const _logger = getLogger('PublishContent');



/**
* Result type for PublishContent command
*/
export interface PublishContentResult {
  success: boolean;
  item?: ContentItem;
  event?: ReturnType<ContentPublished['toEnvelope']>;
  error?: string;
}

/**
* Command handler for publishing content.
*
* This handler publishes a content item, transitioning it from 'draft' or 'scheduled'
* status to 'published'. It validates the content exists and is in a valid state
* before publishing.
*
* @throws Never throws - all errors are caught and returned in the result
*/
export class PublishContent {
  constructor(private readonly repo: ContentRepository) {}

  /**
  * Execute the publish content command
  *
  * @param id - Unique identifier of the content item to publish
  * @returns Promise resolving to the result of the operation
  *
  * @example
  * ```typescript
  * const result = await handler.execute('content-123');
  * if (result.success) {
  *   // Content published successfully
  * } else {
  *   // Handle error: result.error
  * }
  * ```
  */
  async execute(id: string): Promise<PublishContentResult> {
  // Input validation
  const validationError = this.validateInput(id);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    // Fetch the content item
    const item = await this.repo.getById(id);

    // Handle not found case
    if (!item) {
    return {
    success: false,
    error: `Content item with ID '${id}' not found`
    };
    }

    // Validate content state before publishing
    const stateValidationError = this.validateContentState(item);
    if (stateValidationError) {
    return { success: false, error: stateValidationError };
    }

    // Publish the content (immutable - returns new instance)
    const { item: publishedItem, event } = item.publish();

    // Persist the published content
    await this.repo.save(publishedItem);

    return { success: true, item: publishedItem, event } as PublishContentResult;
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to publish content'
    };
  }
  }

  /**
  * Validates the input ID
  *
  * @param id - Content ID to validate
  * @returns Error message if validation fails, undefined otherwise
  */
  private validateInput(id: string): string | undefined {
  if (!id || typeof id !== 'string') {
    return 'Content ID is required and must be a string';
  }
  if (id.length < 1) {
    return 'Content ID cannot be empty';
  }
  return undefined;
  }

  /**
  * Validates the content state before publishing
  *
  * @param item - The content item to validate
  * @returns Error message if validation fails, undefined otherwise
  */
  private validateContentState(item: ContentItem): string | undefined {
  // Check if already published (idempotency)
  if (item["status"] === 'published') {
    return 'Content is already published';
  }

  // Check if archived
  if (item["status"] === 'archived') {
    return 'Cannot publish archived content. Please unarchive first.';
  }

  // Check for required fields
  if (!item["title"] || item["title"].trim().length === 0) {
    return 'Cannot publish content without a title';
  }

  return undefined;
  }
}
