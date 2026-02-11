import { getLogger } from '@kernel/logger';

import { ContentItem } from '../../domain/entities/ContentItem';
import { ContentRepository } from '../ports/ContentRepository';
import { ContentScheduled } from '../../domain/events/ContentScheduled';

const logger = getLogger('ScheduleContent');

﻿

/**
* Result type for ScheduleContent command
*/
export interface ScheduleContentResult {
  success: boolean;
  item?: ContentItem;
  event?: ReturnType<ContentScheduled['toEnvelope']>;
  error?: string;
}

/**
* Command handler for scheduling content publication.
*
* This handler schedules a content item to be published at a future date.
* It validates the content exists, is in 'draft' status, and the scheduled
* time is in the future.
*
* @throws Never throws - all errors are caught and returned in the result
*/
export class ScheduleContent {
  constructor(private readonly repo: ContentRepository) {}

  /**
  * Execute the schedule content command
  *
  * @param id - Unique identifier of the content item to schedule
  * @param publishAt - Date and time when the content should be published
  * @returns Promise resolving to the result of the operation
  *
  * @example
  * ```typescript
  * const result = await handler.execute('content-123', new Date('2024-12-25T10:00:00Z'));
  * if (result.success) {
  *   // Content scheduled successfully
  * } else {
  *   // Handle error: result.error
  * }
  * ```
  */
  async execute(id: string, publishAt: Date): Promise<ScheduleContentResult> {
  // Input validation
  const validationError = this.validateInputs(id, publishAt);
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

    // Validate content state before scheduling
    const stateValidationError = this.validateContentState(item);
    if (stateValidationError) {
    return { success: false, error: stateValidationError };
    }

    // Schedule the content (immutable - returns new instance)
    const { item: scheduledItem, event } = item.schedule(publishAt);

    // Persist the scheduled content
    await this.repo.save(scheduledItem);

    return { success: true, item: scheduledItem, event } as ScheduleContentResult;
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to schedule content'
    };
  }
  }

  /**
  * Validates input parameters
  *
  * @param id - Content ID to validate
  * @param publishAt - Schedule date to validate
  * @returns Error message if validation fails, undefined otherwise
  */
  private validateInputs(id: string, publishAt: Date): string | undefined {
  if (!id || typeof id !== 'string') {
    return 'Content ID is required and must be a string';
  }
  if (id.length < 1) {
    return 'Content ID cannot be empty';
  }
  if (!(publishAt instanceof Date) || isNaN(publishAt.getTime())) {
    return 'Publish date must be a valid Date object';
  }
  if (publishAt.getTime() <= Date.now()) {
    return 'Schedule time must be in the future';
  }
  // Performance: Limit scheduling to reasonable future dates (1 year)
  const oneYearFromNow = Date.now() + (365 * 24 * 60 * 60 * 1000);
  if (publishAt.getTime() > oneYearFromNow) {
    return 'Schedule time cannot be more than 1 year in the future';
  }
  return undefined;
  }

  /**
  * Validates the content state before scheduling
  *
  * @param item - The content item to validate
  * @returns Error message if validation fails, undefined otherwise
  */
  private validateContentState(item: ContentItem): string | undefined {
  // Only drafts can be scheduled
  if (item["status"] !== 'draft') {
    return `Cannot schedule content with status '${item["status"]}'. Only drafts can be scheduled.`;
  }

  // Check for required fields
  if (!item["title"] || item["title"].trim().length === 0) {
    return 'Cannot schedule content without a title';
  }
  if (!item["body"] || item["body"].trim().length === 0) {
    return 'Cannot schedule content without body content';
  }

  return undefined;
  }
}
