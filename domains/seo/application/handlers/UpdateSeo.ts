import { SeoDocument } from '../../domain/entities/SeoDocument';
import { SeoRepository } from '../ports/SeoRepository';
import { SeoUpdated } from '../../domain/events/SeoUpdated';

﻿

/**
* Result type for UpdateSeo command
*/
export interface UpdateSeoResult {
  success: boolean;
  document?: SeoDocument;
  event?: ReturnType<SeoUpdated['toEnvelope']>;
  error?: string;
}

/**
* Command handler for updating SEO metadata.
*
* This handler updates the SEO title and description for a content item.
* It validates inputs and handles the case where the document doesn't exist.
*
* @throws Never throws - all errors are caught and returned in the result
*/
export class UpdateSeo {
  constructor(private readonly repo: SeoRepository) {}

  /**
  * Execute the update SEO command
  *
  * @param id - Unique identifier of the SEO document
  * @param title - New page title (optional)
  * @param description - New meta description (optional)
  * @returns Promise resolving to the result of the operation
  *
  * @example
  * ```typescript
  * const result = await handler.execute('page-123', 'New Title', 'New description');
  * if (result.success) {
  *   // SEO updated successfully
  * } else {
  *   // Handle error: result.error
  * }
  * ```
  */
  async execute(
  id: string,
  title?: string,
  description?: string
  ): Promise<UpdateSeoResult> {
  // Input validation
  const validationError = this.validateInputs(id, title, description);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    // Fetch the SEO document
    const doc = await this.repo.getById(id);

    // Handle not found case
    if (!doc) {
    return {
    success: false,
    error: `SEO document with ID '${id}' not found`
    };
    }

    // Use existing values if not provided
    const newTitle = title ?? doc["title"];
    const newDescription = description ?? doc.description;

    // Update the document (immutable)
    const updatedDoc = doc.update(newTitle, newDescription);

    // Persist the updated document
    await this.repo.save(updatedDoc);

    // Generate domain event
    const event = new SeoUpdated().toEnvelope(id);

    return { success: true, document: updatedDoc, event };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to update SEO document'
    };
  }
  }

  /**
  * Validates input parameters
  *
  * @param id - Document ID to validate
  * @param title - Title to validate
  * @param description - Description to validate
  * @returns Error message if validation fails, undefined otherwise
  */
  private validateInputs(
  id: string,
  title?: string,
  description?: string
  ): string | undefined {
  if (!id || typeof id !== 'string') {
    return 'Document ID is required and must be a string';
  }
  if (id.length < 1) {
    return 'Document ID cannot be empty';
  }
  if (title !== undefined && typeof title !== 'string') {
    return 'Title must be a string';
  }
  if (description !== undefined && typeof description !== 'string') {
    return 'Description must be a string';
  }
  // Security: Validate title length to prevent injection attacks
  if (title && title.length > 500) {
    return 'Title must be less than 500 characters';
  }
  // Security: Validate description length
  if (description && description.length > 2000) {
    return 'Description must be less than 2000 characters';
  }
  return undefined;
  }
}
