/**
 * Branded Types for Type-Safe Identifiers
 * 
 * Architecture Improvement #9: Use branded types to prevent ID confusion
 * at compile time. This ensures UserId cannot be accidentally passed
 * where OrgId is expected.
 * 
 * @example
 * type UserId = Brand<string, 'UserId'>;
 * const userId = createUserId('uuid-string'); // Returns UserId type
 * 
 * function getUser(id: UserId) { ... }
 * getUser(userId); // ✓ OK
 * getUser(orgId); // ✗ Compile error!
 */

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
 * Generic factory for branded UUID types.
 * All branded ID factories share identical validation logic;
 * only the type parameter and error message differ.
 */
function createBrandedUuid<B>(typeName: string) {
  return (value: string): Brand<string, B> => {
    if (!value || typeof value !== 'string') {
      throw new TypeError(`${typeName} must be a non-empty string`);
    }
    if (!isValidUuid(value)) {
      throw new TypeError(`${typeName} must be a valid UUID, got: ${value}`);
    }
    return value as Brand<string, B>;
  };
}

export const createOrgId = createBrandedUuid<'OrgId'>('OrgId');
export const createUserId = createBrandedUuid<'UserId'>('UserId');
export const createDomainId = createBrandedUuid<'DomainId'>('DomainId');
export const createContentId = createBrandedUuid<'ContentId'>('ContentId');
export const createEmailSubscriberId = createBrandedUuid<'EmailSubscriberId'>('EmailSubscriberId');
export const createJobId = createBrandedUuid<'JobId'>('JobId');
export const createPaymentId = createBrandedUuid<'PaymentId'>('PaymentId');
export const createSubscriptionId = createBrandedUuid<'SubscriptionId'>('SubscriptionId');
export const createMediaAssetId = createBrandedUuid<'MediaAssetId'>('MediaAssetId');
export const createAuditEventId = createBrandedUuid<'AuditEventId'>('AuditEventId');

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
 * Generic type guard for branded UUID types.
 * Note: At runtime, all branded UUID guards perform the same check
 * (typeof + UUID format). The type narrowing is compile-time only.
 */
function isBrandedUuid<B>(value: unknown): value is Brand<string, B> {
  return typeof value === 'string' && isValidUuid(value);
}

export function isOrgId(value: unknown): value is OrgId { return isBrandedUuid<'OrgId'>(value); }
export function isUserId(value: unknown): value is UserId { return isBrandedUuid<'UserId'>(value); }
export function isDomainId(value: unknown): value is DomainId { return isBrandedUuid<'DomainId'>(value); }
