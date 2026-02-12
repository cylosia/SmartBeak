import { getLogger } from '@kernel/logger';

import { ContentItem } from '../../domain/entities/ContentItem';
import { ContentRepository } from '../ports/ContentRepository';

const _logger = getLogger('UpdateDraft');



/**
* Result type for UpdateDraft command
*/
export interface UpdateDraftResult {
  success: boolean;
  item?: ContentItem;
  error?: string;
}

/**
* Command handler for updating a content draft.
*
* This handler updates the title and body of a draft content item.
* It validates the content exists and is in an editable state
* (draft or scheduled) before updating.
*
* @throws Never throws - all errors are caught and returned in the result
*/
export class UpdateDraft {
  constructor(private readonly repo: ContentRepository) {}

  /**
  * Execute the update draft command
  *
  * @param id - Unique identifier of the content item to update
  * @param title - New title for the content
  * @param body - New body content
  * @returns Promise resolving to the result of the operation
  *
  * @example
  * ```typescript
  * const result = await handler.execute('content-123', 'Updated Title', 'Updated body...');
  * if (result.success) {
  *   // Draft updated successfully
  * } else {
  *   // Handle error: result.error
  * }
  * ```
  */
  async execute(
  id: string,
  title: string,
  body: string
  ): Promise<UpdateDraftResult> {
  // Input validation
  const validationError = this.validateInputs(id, title, body);
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

    // Validate content state before updating
    const stateValidationError = this.validateContentState(item);
    if (stateValidationError) {
    return { success: false, error: stateValidationError };
    }

    // Update the draft (immutable - returns new instance)
    const updatedItem = item.updateDraft(title, body);

    // Persist the updated content
    await this.repo.save(updatedItem);

    return { success: true, item: updatedItem };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to update draft'
    };
  }
  }

  /**
  * Validates input parameters
  *
  * @param id - Content ID to validate
  * @param title - Title to validate
  * @param body - Body to validate
  * @returns Error message if validation fails, undefined otherwise
  */
  private validateInputs(
  id: string,
  title: string,
  body: string
  ): string | undefined {
  if (!id || typeof id !== 'string') {
    return 'Content ID is required and must be a string';
  }
  if (id.length < 1) {
    return 'Content ID cannot be empty';
  }
  if (typeof title !== 'string') {
    return 'Title must be a string';
  }
  if (typeof body !== 'string') {
    return 'Body must be a string';
  }
  // Security: Validate title length to prevent abuse
  if (title.length > 500) {
    return 'Title must be less than 500 characters';
  }
  // Performance: Validate body size limits
  const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
  if (Buffer.byteLength(body, 'utf8') > MAX_BODY_SIZE) {
    return 'Body content exceeds maximum size of 10MB';
  }
  return undefined;
  }

  /**
  * Validates the content state before updating
  *
  * @param item - The content item to validate
  * @returns Error message if validation fails, undefined otherwise
  */
  private validateContentState(item: ContentItem): string | undefined {
  // Only drafts and scheduled content can be edited
  if (item["status"] !== 'draft' && item["status"] !== 'scheduled') {
    return `Cannot update content with status '${item["status"]}'. Only drafts and scheduled content can be edited.`;
  }
  return undefined;
  }
}
