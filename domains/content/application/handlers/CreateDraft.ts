import { getLogger } from '@kernel/logger';

import { ContentItem, ContentType } from '../../domain/entities/ContentItem';
import { ContentRepository } from '../ports/ContentRepository';

const logger = getLogger('CreateDraft');



/**
* Result type for CreateDraft command
*/
export interface CreateDraftResult {
  success: boolean;
  item?: ContentItem;
  error?: string;
}

/**
* Command handler for creating a new content draft.
*
* This handler validates input parameters, creates a new draft content item,
* and persists it through the repository. It provides error handling for
* invalid inputs and repository failures.
*/
export class CreateDraft {
  constructor(private readonly repo: ContentRepository) {}

  /**
  * Execute the create draft command
  *
  * @param id - Unique identifier for the content (must be at least 3 characters)
  * @param domainId - Identifier for the domain/tenant (required)
  * @param title - Content title (optional, defaults to empty string)
  * @param body - Content body (optional, defaults to empty string)
  * @param contentType - Type of content (optional, defaults to 'article')
  * @returns Promise resolving to the result of the operation
  * @throws Never throws - all errors are caught and returned in the result
  *
  * @example
  * ```typescript
  * const result = await handler.execute('post-123', 'tenant-1', 'My Title', 'Body text');
  * if (result.success) {
  *   // Content created successfully
  * } else {
  *   // Handle error: result.error
  * }
  * ```
  */
  async execute(
  id: string,
  domainId: string,
  title = '',
  body = '',
  contentType: ContentType = 'article'
  ): Promise<CreateDraftResult> {
  // Input validation
  const validationError = this.validateInputs(id, domainId);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const item = ContentItem.createDraft(id, domainId, title, body, contentType);
    await this.repo.save(item);
    return { success: true, item };
  } catch (error) {
    logger.error('Failed to create draft', error instanceof Error ? error : new Error(String(error)));
    return {
    success: false,
    error: 'Failed to create draft'
    };
  }
  }

  /**
  * Validates input parameters
  *
  * @param id - Content ID to validate
  * @param domainId - Domain ID to validate
  * @returns Error message if validation fails, undefined otherwise
  */
  private validateInputs(id: string, domainId: string): string | undefined {
  if (!id || typeof id !== 'string') {
    return 'Content ID is required and must be a string';
  }
  if (id.length < 3) {
    return 'Content ID must be at least 3 characters';
  }
  if (!domainId || typeof domainId !== 'string') {
    return 'Domain ID is required and must be a string';
  }
  return undefined;
  }
}
