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

/** Alias for backward compatibility with kernel/branded.ts consumers */
export type Brand<T, B> = Branded<T, B>;

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

// Additional branded types (consolidated from kernel/branded.ts)
/** Experiment ID branded type */
export type ExperimentId = Branded<string, 'ExperimentId'>;

/** Membership ID branded type */
export type MembershipId = Branded<string, 'MembershipId'>;
/** Domain Registry ID branded type */
export type DomainRegistryId = Branded<string, 'DomainRegistryId'>;
/** Content Version ID branded type */
export type ContentVersionId = Branded<string, 'ContentVersionId'>;
/** Content Idea ID branded type */
export type ContentIdeaId = Branded<string, 'ContentIdeaId'>;
/** Media Collection ID branded type */
export type MediaCollectionId = Branded<string, 'MediaCollectionId'>;
/** Email Subscriber ID branded type */
export type EmailSubscriberId = Branded<string, 'EmailSubscriberId'>;
/** Email Campaign ID branded type */
export type EmailCampaignId = Branded<string, 'EmailCampaignId'>;
/** Email Template ID branded type */
export type EmailTemplateId = Branded<string, 'EmailTemplateId'>;
/** Job ID branded type */
export type JobId = Branded<string, 'JobId'>;
/** Task ID branded type */
export type TaskId = Branded<string, 'TaskId'>;
/** Export ID branded type */
export type ExportId = Branded<string, 'ExportId'>;
/** Analytics Event ID branded type */
export type AnalyticsEventId = Branded<string, 'AnalyticsEventId'>;
/** Metric ID branded type */
export type MetricId = Branded<string, 'MetricId'>;
/** Report ID branded type */
export type ReportId = Branded<string, 'ReportId'>;
/** Subscription ID branded type */
export type SubscriptionId = Branded<string, 'SubscriptionId'>;
/** Affiliate ID branded type */
export type AffiliateId = Branded<string, 'AffiliateId'>;
/** Commission ID branded type */
export type CommissionId = Branded<string, 'CommissionId'>;

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

// ============================================================================
// Additional Factory Functions (consolidated from kernel/branded.ts)
// ============================================================================

// P2-FIX: Add factory functions for branded types that were defined but had no
// corresponding createXxx() function. Without these, call sites were forced to
// use unsafe `id as MembershipId` casts, bypassing UUID validation entirely.
// Financial IDs (AffiliateId, CommissionId) and auth IDs (MembershipId) are
// highest priority — invalid values in those paths corrupt audit/billing records.

/** Factory function for MembershipId */
export function createMembershipId(id: string): MembershipId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid MembershipId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as MembershipId;
}

/** Factory function for DomainRegistryId */
export function createDomainRegistryId(id: string): DomainRegistryId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid DomainRegistryId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as DomainRegistryId;
}

/** Factory function for ContentVersionId */
export function createContentVersionId(id: string): ContentVersionId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid ContentVersionId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as ContentVersionId;
}

/** Factory function for ContentIdeaId */
export function createContentIdeaId(id: string): ContentIdeaId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid ContentIdeaId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as ContentIdeaId;
}

/** Factory function for MediaCollectionId */
export function createMediaCollectionId(id: string): MediaCollectionId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid MediaCollectionId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as MediaCollectionId;
}

/** Factory function for EmailCampaignId */
export function createEmailCampaignId(id: string): EmailCampaignId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid EmailCampaignId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as EmailCampaignId;
}

/** Factory function for EmailTemplateId */
export function createEmailTemplateId(id: string): EmailTemplateId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid EmailTemplateId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as EmailTemplateId;
}

/** Factory function for TaskId */
export function createTaskId(id: string): TaskId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid TaskId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as TaskId;
}

/** Factory function for ExportId */
export function createExportId(id: string): ExportId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid ExportId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as ExportId;
}

/** Factory function for AnalyticsEventId */
export function createAnalyticsEventId(id: string): AnalyticsEventId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid AnalyticsEventId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as AnalyticsEventId;
}

/** Factory function for MetricId */
export function createMetricId(id: string): MetricId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid MetricId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as MetricId;
}

/** Factory function for ReportId */
export function createReportId(id: string): ReportId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid ReportId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as ReportId;
}

/** Factory function for AffiliateId */
export function createAffiliateId(id: string): AffiliateId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid AffiliateId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as AffiliateId;
}

/** Factory function for CommissionId */
export function createCommissionId(id: string): CommissionId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid CommissionId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as CommissionId;
}

/** Factory function for EmailSubscriberId */
export function createEmailSubscriberId(id: string): EmailSubscriberId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid EmailSubscriberId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as EmailSubscriberId;
}

/** Factory function for JobId */
export function createJobId(id: string): JobId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid JobId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as JobId;
}

/** Factory function for SubscriptionId */
export function createSubscriptionId(id: string): SubscriptionId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid SubscriptionId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as SubscriptionId;
}

/**
 * Create a branded ExperimentId from a string.
 * P1-TYPE FIX: Experiment.id was typed as plain `string`, allowing any string
 * (including invalid UUIDs or IDs from other entity types) to be passed where
 * an ExperimentId is expected. Branded type enforces UUID format at construction
 * time and prevents accidental mixing with ContentId, UserId, etc.
 * @throws ValidationError if the ID is not a valid UUID
 */
export function createExperimentId(id: string): ExperimentId {
  if (!isUUID(id)) {
    throw new ValidationError(`Invalid ExperimentId format: ${id}. Expected valid UUID.`, 'id', ErrorCodes.INVALID_UUID);
  }
  return id as ExperimentId;
}

/** Type guard for any valid UUID string */
export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && isUUID(value);
}

/**
 * UNSAFE: Cast any value to any branded type without validation.
 *
 * @internal Only for use within ORM/database mapping layers inside
 * `packages/kernel` where the underlying value is already guaranteed to be a
 * validated UUID (e.g. rows returned from a DB column with a UUID check
 * constraint). Do NOT use this in application code — use the specific
 * `createXxx()` factory functions which enforce UUID validation.
 *
 * P2-FIX: Added @internal marker to prevent accidental use as a general-purpose
 * escape hatch. The generic signature `<T, B>` lets callers bypass the entire
 * branded type system for any type with no runtime guard.
 */
export function unsafeBrand<T, B>(value: T): Brand<T, B> {
  return value as Brand<T, B>;
}
