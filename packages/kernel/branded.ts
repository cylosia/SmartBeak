/**
 * Branded Types for Type-Safe Identifiers
 *
 * @deprecated Prefer importing from '@kernel/validation/branded' which is the
 * canonical implementation. This file uses `Brand<T, B>` while the validation
 * module uses `Branded<T, B>` — these are structurally identical but nominally
 * different types. New code should use the validation module to avoid type
 * incompatibilities.
 */

import { ValidationError, ErrorCodes } from './validation/types-base';

/**
 * Brand type for nominal typing
 * Intersects base type T with unique brand B to create distinct type
 */
export type Brand<T, B> = T & { readonly __brand: B };

// ============================================================================
// Organization & User IDs
// ============================================================================

/** Organization ID - identifies a tenant/organization */
export type OrgId = Brand<string, 'OrgId'>;

/** User ID - identifies a user account */
export type UserId = Brand<string, 'UserId'>;

/** Membership ID - identifies an org membership */
export type MembershipId = Brand<string, 'MembershipId'>;

// ============================================================================
// Domain IDs
// ============================================================================

/** Domain ID - identifies a domain */
export type DomainId = Brand<string, 'DomainId'>;

/** Domain Registry ID - identifies a domain registration */
export type DomainRegistryId = Brand<string, 'DomainRegistryId'>;

// ============================================================================
// Content IDs
// ============================================================================

/** Content Item ID - identifies a content item */
export type ContentId = Brand<string, 'ContentId'>;

/** Content Version ID - identifies a content version */
export type ContentVersionId = Brand<string, 'ContentVersionId'>;

/** Content Idea ID - identifies a content idea */
export type ContentIdeaId = Brand<string, 'ContentIdeaId'>;

// ============================================================================
// Media IDs
// ============================================================================

/** Media Asset ID - identifies a media asset */
export type MediaAssetId = Brand<string, 'MediaAssetId'>;

/** Media Collection ID - identifies a media collection */
export type MediaCollectionId = Brand<string, 'MediaCollectionId'>;

// ============================================================================
// Email Subscriber IDs
// ============================================================================

/** Email Subscriber ID - identifies an email subscriber */
export type EmailSubscriberId = Brand<string, 'EmailSubscriberId'>;

/** Email Campaign ID - identifies an email campaign */
export type EmailCampaignId = Brand<string, 'EmailCampaignId'>;

/** Email Template ID - identifies an email template */
export type EmailTemplateId = Brand<string, 'EmailTemplateId'>;

// ============================================================================
// Job & Task IDs
// ============================================================================

/** Job ID - identifies a background job */
export type JobId = Brand<string, 'JobId'>;

/** Task ID - identifies a scheduled task */
export type TaskId = Brand<string, 'TaskId'>;

/** Export ID - identifies an export operation */
export type ExportId = Brand<string, 'ExportId'>;

// ============================================================================
// Analytics & Metrics IDs
// ============================================================================

/** Analytics Event ID - identifies an analytics event */
export type AnalyticsEventId = Brand<string, 'AnalyticsEventId'>;

/** Metric ID - identifies a tracked metric */
export type MetricId = Brand<string, 'MetricId'>;

/** Report ID - identifies a generated report */
export type ReportId = Brand<string, 'ReportId'>;

// ============================================================================
// Financial IDs
// ============================================================================

/** Subscription ID - identifies a subscription */
export type SubscriptionId = Brand<string, 'SubscriptionId'>;

/** Invoice ID - identifies an invoice */
export type InvoiceId = Brand<string, 'InvoiceId'>;

/** Payment ID - identifies a payment transaction */
export type PaymentId = Brand<string, 'PaymentId'>;

/** Affiliate ID - identifies an affiliate */
export type AffiliateId = Brand<string, 'AffiliateId'>;

/** Commission ID - identifies a commission record */
export type CommissionId = Brand<string, 'CommissionId'>;

// ============================================================================
// Audit & Security IDs
// ============================================================================

/** Audit Event ID - identifies an audit log entry */
export type AuditEventId = Brand<string, 'AuditEventId'>;

/** Session ID - identifies a user session */
export type SessionId = Brand<string, 'SessionId'>;

/** API Key ID - identifies an API key */
export type ApiKeyId = Brand<string, 'ApiKeyId'>;

// ============================================================================
// Factory Functions with Validation
// ============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Validate UUID format
 */
function isValidUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/**
 * Factory function for OrgId with runtime validation
 */
export function createOrgId(value: string): OrgId {
  if (!value || typeof value !== 'string') {
    throw new ValidationError('OrgId must be a non-empty string', 'id', ErrorCodes.VALIDATION_ERROR);
  }
  if (!isValidUuid(value)) {
    throw new ValidationError(`OrgId must be a valid UUID, got: ${value}`, 'id', ErrorCodes.INVALID_UUID);
  }
  return value as OrgId;
}

/**
 * Factory function for UserId with runtime validation
 */
export function createUserId(value: string): UserId {
  if (!value || typeof value !== 'string') {
    throw new ValidationError('UserId must be a non-empty string', 'id', ErrorCodes.VALIDATION_ERROR);
  }
  if (!isValidUuid(value)) {
    throw new ValidationError(`UserId must be a valid UUID, got: ${value}`, 'id', ErrorCodes.INVALID_UUID);
  }
  return value as UserId;
}

/**
 * Factory function for DomainId with runtime validation
 */
export function createDomainId(value: string): DomainId {
  if (!value || typeof value !== 'string') {
    throw new ValidationError('DomainId must be a non-empty string', 'id', ErrorCodes.VALIDATION_ERROR);
  }
  if (!isValidUuid(value)) {
    throw new ValidationError(`DomainId must be a valid UUID, got: ${value}`, 'id', ErrorCodes.INVALID_UUID);
  }
  return value as DomainId;
}

/**
 * Factory function for ContentId with runtime validation
 */
export function createContentId(value: string): ContentId {
  if (!value || typeof value !== 'string') {
    throw new ValidationError('ContentId must be a non-empty string', 'id', ErrorCodes.VALIDATION_ERROR);
  }
  if (!isValidUuid(value)) {
    throw new ValidationError(`ContentId must be a valid UUID, got: ${value}`, 'id', ErrorCodes.INVALID_UUID);
  }
  return value as ContentId;
}

/**
 * Factory function for EmailSubscriberId with runtime validation
 */
export function createEmailSubscriberId(value: string): EmailSubscriberId {
  if (!value || typeof value !== 'string') {
    throw new ValidationError('EmailSubscriberId must be a non-empty string', 'id', ErrorCodes.VALIDATION_ERROR);
  }
  if (!isValidUuid(value)) {
    throw new ValidationError(`EmailSubscriberId must be a valid UUID, got: ${value}`, 'id', ErrorCodes.INVALID_UUID);
  }
  return value as EmailSubscriberId;
}

/**
 * Factory function for JobId with runtime validation
 */
export function createJobId(value: string): JobId {
  if (!value || typeof value !== 'string') {
    throw new ValidationError('JobId must be a non-empty string', 'id', ErrorCodes.VALIDATION_ERROR);
  }
  if (!isValidUuid(value)) {
    throw new ValidationError(`JobId must be a valid UUID, got: ${value}`, 'id', ErrorCodes.INVALID_UUID);
  }
  return value as JobId;
}

/**
 * Factory function for PaymentId with runtime validation
 */
export function createPaymentId(value: string): PaymentId {
  if (!value || typeof value !== 'string') {
    throw new ValidationError('PaymentId must be a non-empty string', 'id', ErrorCodes.VALIDATION_ERROR);
  }
  if (!isValidUuid(value)) {
    throw new ValidationError(`PaymentId must be a valid UUID, got: ${value}`, 'id', ErrorCodes.INVALID_UUID);
  }
  return value as PaymentId;
}

/**
 * Factory function for SubscriptionId with runtime validation
 */
export function createSubscriptionId(value: string): SubscriptionId {
  if (!value || typeof value !== 'string') {
    throw new ValidationError('SubscriptionId must be a non-empty string', 'id', ErrorCodes.VALIDATION_ERROR);
  }
  if (!isValidUuid(value)) {
    throw new ValidationError(`SubscriptionId must be a valid UUID, got: ${value}`, 'id', ErrorCodes.INVALID_UUID);
  }
  return value as SubscriptionId;
}

/**
 * Factory function for MediaAssetId with runtime validation
 */
export function createMediaAssetId(value: string): MediaAssetId {
  if (!value || typeof value !== 'string') {
    throw new ValidationError('MediaAssetId must be a non-empty string', 'id', ErrorCodes.VALIDATION_ERROR);
  }
  if (!isValidUuid(value)) {
    throw new ValidationError(`MediaAssetId must be a valid UUID, got: ${value}`, 'id', ErrorCodes.INVALID_UUID);
  }
  return value as MediaAssetId;
}

/**
 * Factory function for AuditEventId with runtime validation
 */
export function createAuditEventId(value: string): AuditEventId {
  if (!value || typeof value !== 'string') {
    throw new ValidationError('AuditEventId must be a non-empty string', 'id', ErrorCodes.VALIDATION_ERROR);
  }
  if (!isValidUuid(value)) {
    throw new ValidationError(`AuditEventId must be a valid UUID, got: ${value}`, 'id', ErrorCodes.INVALID_UUID);
  }
  return value as AuditEventId;
}

/**
 * Unsafe cast for cases where validation is already done
 * Use sparingly - prefer factory functions
 */
export function unsafeBrand<T, B>(value: T): Brand<T, B> {
  return value as Brand<T, B>;
}

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard to check if value is a valid UUID string
 */
export function isValidId(value: unknown): value is string {
  return typeof value === 'string' && isValidUuid(value);
}

/**
 * Type guard for OrgId
 */
export function isOrgId(value: unknown): value is OrgId {
  return typeof value === 'string' && isValidUuid(value);
}

/**
 * Type guard for UserId
 */
export function isUserId(value: unknown): value is UserId {
  return typeof value === 'string' && isValidUuid(value);
}

/**
 * Type guard for DomainId
 */
export function isDomainId(value: unknown): value is DomainId {
  return typeof value === 'string' && isValidUuid(value);
}
