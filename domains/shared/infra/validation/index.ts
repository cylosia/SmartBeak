/**
 * Shared Infrastructure Validation Module
 *
 * This module provides validation utilities for the database layer
 * including validation functions for JSONB fields.
 */

export type {
  NotificationPayload,
  NotificationAttachment,
  SearchDocumentFields,
  SearchDocumentAuthor,
  PublishTargetConfig,
  PublishTargetRetryPolicy,
  PublishTargetAuth,
  PublishTargetRateLimit,
  PublishTargetContentTransform,
} from './types';

// Validation functions
export {
  validateNotificationPayload,
  validateSearchDocument,
  validatePublishTarget,
} from './validators';

// Errors
export { ValidationError } from './errors';
