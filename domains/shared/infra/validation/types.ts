/**
 * Shared Validation Types
 * Type definitions for validation utilities
 */

// Re-export types from packages/types for convenience
export type {
  NotificationPayload,
  NotificationAttachment,
} from '@types/notifications';

export type {
  PublishTargetConfig,
  PublishTargetRetryPolicy,
  PublishTargetAuth,
  PublishTargetRateLimit,
  PublishTargetContentTransform,
} from '@types/publishing';

/**
 * Search document author information
 */
export interface SearchDocumentAuthor {
  id?: string;
  name?: string;
  email?: string;
}

/**
 * Search document fields
 */
export interface SearchDocumentFields {
  title?: string;
  content?: string;
  excerpt?: string;
  author?: SearchDocumentAuthor;
  tags?: string[];
  category?: string;
  publishedAt?: Date;
  updatedAt?: Date;
}
