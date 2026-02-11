/**
 * Branded Types
 * 
 * Provides branded type factories for type-safe IDs throughout the application.
 * Branded types prevent accidental mixing of different ID types at compile time.
 * 
 * @example
 * const userId = createUserId('123e4567-e89b-12d3-a456-426614174000');
 * const orgId = createOrgId('123e4567-e89b-12d3-a456-426614174001');
 * 
 * // Type error: Cannot assign UserId to OrgId
 * // const wrong: OrgId = userId;
 */

import { isValidUUID as isUUID } from './uuid';
import { ValidationError, ErrorCodes } from './types-base';

// ============================================================================
// Branded Type Definitions
// ============================================================================

/** Branded type helper */
export type Branded<T, B> = T & { readonly __brand: B };

/** User ID branded type */
export type UserId = Branded<string, 'UserId'>;

/** Organization ID branded type */
export type OrgId = Branded<string, 'OrgId'>;

/** Session ID branded type */
export type SessionId = Branded<string, 'SessionId'>;

/** Content ID branded type */
export type ContentId = Branded<string, 'ContentId'>;

/** Domain ID branded type */
export type DomainId = Branded<string, 'DomainId'>;

/** Customer ID branded type */
export type CustomerId = Branded<string, 'CustomerId'>;

/** Invoice ID branded type */
export type InvoiceId = Branded<string, 'InvoiceId'>;

/** Payment ID branded type */
export type PaymentId = Branded<string, 'PaymentId'>;

/** Publishing Job ID branded type */
export type PublishingJobId = Branded<string, 'PublishingJobId'>;

/** Notification ID branded type */
export type NotificationId = Branded<string, 'NotificationId'>;

/** Media Asset ID branded type */
export type MediaAssetId = Branded<string, 'MediaAssetId'>;

/** Search Index ID branded type */
export type SearchIndexId = Branded<string, 'SearchIndexId'>;

/** Indexing Job ID branded type */
export type IndexingJobId = Branded<string, 'IndexingJobId'>;

/** Author ID branded type */
export type AuthorId = Branded<string, 'AuthorId'>;

/** Content Revision ID branded type */
export type RevisionId = Branded<string, 'RevisionId'>;

/** Comment ID branded type */
export type CommentId = Branded<string, 'CommentId'>;

/** Webhook ID branded type */
export type WebhookId = Branded<string, 'WebhookId'>;

/** API Key ID branded type */
export type ApiKeyId = Branded<string, 'ApiKeyId'>;

/** Audit Event ID branded type */
export type AuditEventId = Branded<string, 'AuditEventId'>;

// ============================================================================
// Branded Type Factory Functions
// ============================================================================

/**
 * Create a branded UserId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createUserId(id: string): UserId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid UserId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as UserId;
}

/**
 * Create a branded OrgId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createOrgId(id: string): OrgId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid OrgId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as OrgId;
}

/**
 * Create a branded SessionId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createSessionId(id: string): SessionId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid SessionId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as SessionId;
}

/**
 * Create a branded ContentId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createContentId(id: string): ContentId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid ContentId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as ContentId;
}

/**
 * Create a branded DomainId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createDomainId(id: string): DomainId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid DomainId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as DomainId;
}

/**
 * Create a branded CustomerId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createCustomerId(id: string): CustomerId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid CustomerId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as CustomerId;
}

/**
 * Create a branded InvoiceId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createInvoiceId(id: string): InvoiceId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid InvoiceId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as InvoiceId;
}

/**
 * Create a branded PaymentId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createPaymentId(id: string): PaymentId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid PaymentId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as PaymentId;
}

/**
 * Create a branded PublishingJobId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createPublishingJobId(id: string): PublishingJobId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid PublishingJobId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as PublishingJobId;
}

/**
 * Create a branded NotificationId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createNotificationId(id: string): NotificationId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid NotificationId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as NotificationId;
}

/**
 * Create a branded MediaAssetId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createMediaAssetId(id: string): MediaAssetId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid MediaAssetId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as MediaAssetId;
}

/**
 * Create a branded SearchIndexId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createSearchIndexId(id: string): SearchIndexId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid SearchIndexId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as SearchIndexId;
}

/**
 * Create a branded IndexingJobId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createIndexingJobId(id: string): IndexingJobId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid IndexingJobId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as IndexingJobId;
}

/**
 * Create a branded AuthorId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createAuthorId(id: string): AuthorId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid AuthorId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as AuthorId;
}

/**
 * Create a branded RevisionId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createRevisionId(id: string): RevisionId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid RevisionId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as RevisionId;
}

/**
 * Create a branded CommentId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createCommentId(id: string): CommentId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid CommentId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as CommentId;
}

/**
 * Create a branded WebhookId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createWebhookId(id: string): WebhookId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid WebhookId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as WebhookId;
}

/**
 * Create a branded ApiKeyId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createApiKeyId(id: string): ApiKeyId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid ApiKeyId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as ApiKeyId;
}

/**
 * Create a branded AuditEventId from a string
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createAuditEventId(id: string): AuditEventId {
  if (!isUUID(id)) {
    throw new ValidationError(
      `Invalid AuditEventId format: ${id}. Expected valid UUID.`,
      'id',
      ErrorCodes.INVALID_UUID
    );
  }
  return id as AuditEventId;
}

// ============================================================================
// Type Guards for Branded Types
// ============================================================================

/** Type guard for UserId */
export function isUserId(value: unknown): value is UserId {
  return typeof value === 'string' && isUUID(value);
}

/** Type guard for OrgId */
export function isOrgId(value: unknown): value is OrgId {
  return typeof value === 'string' && isUUID(value);
}

/** Type guard for ContentId */
export function isContentId(value: unknown): value is ContentId {
  return typeof value === 'string' && isUUID(value);
}

/** Type guard for DomainId */
export function isDomainId(value: unknown): value is DomainId {
  return typeof value === 'string' && isUUID(value);
}

/** Type guard for CustomerId */
export function isCustomerId(value: unknown): value is CustomerId {
  return typeof value === 'string' && isUUID(value);
}

/** Type guard for InvoiceId */
export function isInvoiceId(value: unknown): value is InvoiceId {
  return typeof value === 'string' && isUUID(value);
}

/** Type guard for PaymentId */
export function isPaymentId(value: unknown): value is PaymentId {
  return typeof value === 'string' && isUUID(value);
}

// ============================================================================
// Unsafe Conversion (for database reads where UUID is already validated)
// ============================================================================

/**
 * UNSAFE: Cast a string to UserId without validation.
 * Only use this when reading from database where UUID is already validated.
 * @deprecated Use createUserId for new IDs
 */
export function unsafeAsUserId(id: string): UserId {
  return id as UserId;
}

/**
 * UNSAFE: Cast a string to OrgId without validation.
 * Only use this when reading from database where UUID is already validated.
 * @deprecated Use createOrgId for new IDs
 */
export function unsafeAsOrgId(id: string): OrgId {
  return id as OrgId;
}

/**
 * UNSAFE: Cast a string to ContentId without validation.
 * Only use this when reading from database where UUID is already validated.
 * @deprecated Use createContentId for new IDs
 */
export function unsafeAsContentId(id: string): ContentId {
  return id as ContentId;
}

/**
 * UNSAFE: Cast a string to DomainId without validation.
 * Only use this when reading from database where UUID is already validated.
 * @deprecated Use createDomainId for new IDs
 */
export function unsafeAsDomainId(id: string): DomainId {
  return id as DomainId;
}
