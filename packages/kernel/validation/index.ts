/**
 * Validation Package
 * 
 * Centralized validation utilities, branded types, and type guards.
 * 
 * @example
 * ```typescript
 * import { createUserId, isUUID, assertNever } from '@kernel/validation';
 * 
 * // Create branded ID
 * const userId = createUserId('123e4567-e89b-12d3-a456-426614174000');
 * 
 * // Type guard
 * if (isUUID(someValue)) {
 *   // someValue is typed as string (UUID)
 * }
 * ```
 */

// ============================================================================
// Base Types (no dependencies)
// ============================================================================
export {
  ErrorCodes,
  type ErrorCode,
  ValidationError,
  ExternalAPIError,
} from './types-base';

// ============================================================================
// UUID Validation
// ============================================================================
export {
  isValidUUID,
  validateUUID,
  normalizeUUID,
  generateUUID,
} from './uuid';

// ============================================================================
// Branded Types (type-safe IDs)
// ============================================================================
export type {
  Branded,
  UserId,
  OrgId,
  SessionId,
  ContentId,
  DomainId,
  CustomerId,
  InvoiceId,
  PaymentId,
  PublishingJobId,
  NotificationId,
  MediaAssetId,
  SearchIndexId,
  IndexingJobId,
  AuthorId,
  RevisionId,
  CommentId,
  WebhookId,
  ApiKeyId,
  AuditEventId,
} from './branded';

export {
  // Branded type factories
  createUserId,
  createOrgId,
  createSessionId,
  createContentId,
  createDomainId,
  createCustomerId,
  createInvoiceId,
  createPaymentId,
  createPublishingJobId,
  createNotificationId,
  createMediaAssetId,
  createSearchIndexId,
  createIndexingJobId,
  createAuthorId,
  createRevisionId,
  createCommentId,
  createWebhookId,
  createApiKeyId,
  createAuditEventId,
  // Type guards
  isUserId,
  isOrgId,
  isContentId,
  isDomainId,
  isCustomerId,
  isInvoiceId,
  isPaymentId,
  // Unsafe conversions (use with caution)
  unsafeAsUserId,
  unsafeAsOrgId,
  unsafeAsContentId,
  unsafeAsDomainId,
} from './branded';

// ============================================================================
// Core Type Utilities
// ============================================================================
export type {
  AnyId,
  ErrorContext,
  ContentState,
  PublishingJobState,
  NotificationState,
  UserRole,
  DeepRequired,
  DeepPartial,
  PickRequired,
  NonEmptyArray,
  AtLeastOne,
  TypeMap,
  Result,
  ValidationErrorBase,
} from './types';

export {
  // Type guards
  isNonEmptyString,
  isUUID,
  isPositiveInteger,
  isNonNegativeInteger,
  // Facebook type guards
  isFacebookErrorResponse,
  isFacebookPostResponse,
  // Exhaustiveness checking
  assertNever,
  handleExhaustive,
  // Result type helpers
  ok,
  err,
  unwrap,
  mapResult,
  flatMapResult,
  // Error context
  createErrorContext,
} from './types';

// ============================================================================
// Schema Validation
// ============================================================================
export {
  PaginationQuerySchema,
  SearchQuerySchema,
  DateRangeSchema,
  MoneyCentsSchema,
  UrlSchema,
  createEnumSchema,
  validateEnum,
  sanitizeSearchQuery,
  validateArrayLength,
  validateStringLength,
  validateNonEmptyString,
  isValidDate,
  normalizeDate,
  dollarsToCents,
  centsToDollars,
  type PaginationQuery,
  type SearchQuery,
  type DateRange,
  type MoneyCents,
} from './schemas';

// ============================================================================
// API Response Type Guards (third-party integrations)
// ============================================================================
export {
  isAWeberErrorResponse,
  isAWeberListResponse,
  isConstantContactErrorsResponse,
  isConstantContactListResponse,
} from './apiGuards';

// ============================================================================
// Email Validation
// ============================================================================
export {
  isValidEmail,
  normalizeEmail,
  EmailSchema,
} from './email';

// ============================================================================
// JSONB Validation
// ============================================================================
export {
  calculateJSONBSize,
  validateJSONBSize,
  assertJSONBSize,
  fitsInJSONB,
  serializeForJSONB,
  truncateJSONB,
  safeStringify,
  MAX_JSONB_SIZE,
  MAX_JSONB_SIZE_LARGE,
  type JsonValue,
} from './jsonb';

// ============================================================================
// Error Helpers
// ============================================================================
export {
  formatValidationErrors,
  createValidationError,
  isValidationError,
  normalizeError,
  type FormattedValidationError,
} from './errorHelpers';


