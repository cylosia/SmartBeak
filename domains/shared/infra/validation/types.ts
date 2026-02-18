/**
 * Shared Validation Types
 * Type definitions for validation utilities
 */

// Re-export types from packages/types for convenience
export type {
  NotificationPayload,
  NotificationAttachment,
} from '@packages/types/notifications';

export type {
  PublishTargetConfig,
  PublishTargetRetryPolicy,
  PublishTargetAuth,
  PublishTargetRateLimit,
  PublishTargetContentTransform,
} from '@packages/types/publishing';

/**
 * Search document author information
 * FIXED (VT-1): Removed `email` field — author email is PII and must never be stored
 * in a search index that is accessible to end-users (GDPR Article 5(1)(c) data minimisation).
 * If internal author linkage is needed, use `id` only.
 */
export interface SearchDocumentAuthor {
  id?: string;
  name?: string;
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
