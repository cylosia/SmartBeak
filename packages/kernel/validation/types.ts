/**
 * Core Type Validation Utilities
 * 
 * Provides type guards, branded types, and exhaustiveness checking utilities
 * for type-safe development throughout the application.
 */

import { ValidationError, ErrorCodes } from './types-base';
import { getLogger } from '../logger';

const logger = getLogger('kernel:validation');

// ============================================================================
// Branded Type Factory
// ============================================================================

/**
 * Branded type helper - creates a nominal type from a structural type
 * Use this to prevent accidental mixing of different ID types
 * 
 * @example
 * type UserId = Branded<string, 'UserId'>;
 * const userId = '123' as UserId; // Only explicit casting allowed
 */
export type Branded<T, B> = T & { readonly __brand: B };

// ============================================================================
// ID Type Definitions
// ============================================================================

/** User ID - identifies a user in the system */
export type UserId = Branded<string, 'UserId'>;

/** Organization ID - identifies an organization/tenant */
export type OrgId = Branded<string, 'OrgId'>;

/** Session ID - identifies an authenticated session */
export type SessionId = Branded<string, 'SessionId'>;

/** Content ID - identifies a content item */
export type ContentId = Branded<string, 'ContentId'>;

/** Domain ID - identifies a domain/tenant */
export type DomainId = Branded<string, 'DomainId'>;

/** Customer ID - identifies a customer (billing) */
export type CustomerId = Branded<string, 'CustomerId'>;

/** Invoice ID - identifies a billing invoice */
export type InvoiceId = Branded<string, 'InvoiceId'>;

/** Payment ID - identifies a payment transaction */
export type PaymentId = Branded<string, 'PaymentId'>;

/** Publishing Job ID - identifies a publishing operation */
export type PublishingJobId = Branded<string, 'PublishingJobId'>;

/** Notification ID - identifies a notification */
export type NotificationId = Branded<string, 'NotificationId'>;

/** Media Asset ID - identifies a media asset */
export type MediaAssetId = Branded<string, 'MediaAssetId'>;

/** Search Index ID - identifies a search index */
export type SearchIndexId = Branded<string, 'SearchIndexId'>;

/** Indexing Job ID - identifies a search indexing job */
export type IndexingJobId = Branded<string, 'IndexingJobId'>;

/** Author ID - identifies a content author */
export type AuthorId = Branded<string, 'AuthorId'>;

/** Revision ID - identifies a content revision */
export type RevisionId = Branded<string, 'RevisionId'>;

/** Comment ID - identifies a comment */
export type CommentId = Branded<string, 'CommentId'>;

/** Webhook ID - identifies a webhook configuration */
export type WebhookId = Branded<string, 'WebhookId'>;

/** API Key ID - identifies an API key */
export type ApiKeyId = Branded<string, 'ApiKeyId'>;

/** Audit Event ID - identifies an audit log entry */
export type AuditEventId = Branded<string, 'AuditEventId'>;

// ============================================================================
// ID Type Union
// ============================================================================

/** All ID types union - useful for generic ID handling */
export type AnyId =
  | UserId
  | OrgId
  | SessionId
  | ContentId
  | DomainId
  | CustomerId
  | InvoiceId
  | PaymentId
  | PublishingJobId
  | NotificationId
  | MediaAssetId
  | SearchIndexId
  | IndexingJobId
  | AuthorId
  | RevisionId
  | CommentId
  | WebhookId
  | ApiKeyId
  | AuditEventId;

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Validates that a value is a non-empty string
 */
export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Alias for isNonEmptyString for backwards compatibility
 * @deprecated Use isNonEmptyString instead
 */
export const validateNonEmptyString = isNonEmptyString;

/**
 * Validates that a value is a valid UUID format
 */
export function isUUID(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(value);
}

/**
 * Validates that a value is a positive integer
 */
export function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

/**
 * Validates that a value is a non-negative integer
 */
export function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * Type guard for UserId
 */
export function isUserId(value: unknown): value is UserId {
  return isUUID(value);
}

/**
 * Type guard for OrgId
 */
export function isOrgId(value: unknown): value is OrgId {
  return isUUID(value);
}

/**
 * Type guard for ContentId
 */
export function isContentId(value: unknown): value is ContentId {
  return isUUID(value);
}

/**
 * Type guard for DomainId
 */
export function isDomainId(value: unknown): value is DomainId {
  return isUUID(value);
}

// ============================================================================
// Exhaustiveness Checking
// ============================================================================

/**
 * Asserts that a switch statement is exhaustive.
 * Call this in the default case to ensure all cases are handled.
 * 
 * @example
 * switch (status) {
 *   case 'pending': return ...;
 *   case 'active': return ...;
 *   default: assertNever(status, 'Unhandled status');
 * }
 * 
 * @param value - The value that should never exist (if switch is exhaustive)
 * @param message - Optional message for the error
 * @throws Error always - this should never be called if switch is exhaustive
 */
export function assertNever(value: never, message?: string): never {
  throw new Error(message || `Unhandled case: ${String(value)}`);
}

/**
 * Exhaustiveness check that returns a value instead of throwing.
 * Useful when you need to handle the "impossible" case gracefully.
 * 
 * @example
 * const result = switch (status) {
 *   case 'pending': return 'Waiting...';
 *   case 'active': return 'Running';
 *   default: return handleExhaustive(status, 'Unknown');
 * }
 */
export function handleExhaustive<T>(value: never, fallback: T): T {
  logger.error(`Exhaustiveness check failed for: ${String(value)}`);
  return fallback;
}

// ============================================================================
// Result Type
// ============================================================================

/**
 * Result type for operations that can fail.
 * Use this instead of throwing exceptions for expected errors.
 * 
 * @example
 * function parseNumber(str: string): Result<number, ParseError> {
 *   const num = parseFloat(str);
 *   if (isNaN(num)) return { ok: false, error: new ParseError('Invalid number') };
 *   return { ok: true, value: num };
 * }
 */
export type Result<T, E = Error> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/**
 * Create a success result
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Create a failure result
 */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

/**
 * Unwrap a result or throw if error
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) {
    throw (result as { ok: false; error: E }).error instanceof Error 
      ? (result as { ok: false; error: E }).error 
      : new Error(String((result as { ok: false; error: E }).error));
  }
  return result.value;
}

/**
 * Map a result's value type
 */
export function mapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => U
): Result<U, E> {
  if (!result.ok) return result as Result<U, E>;
  return ok(fn(result.value));
}

/**
 * Flat map (bind) for results - chains operations that return results
 */
export function flatMapResult<T, U, E>(
  result: Result<T, E>,
  fn: (value: T) => Result<U, E>
): Result<U, E> {
  if (!result.ok) return result as Result<U, E>;
  return fn(result.value);
}

// ============================================================================
// Error Context Types
// ============================================================================

/**
 * Context information for errors
 */
export interface ErrorContext {
  /** Operation being performed when error occurred */
  operation: string;
  
  /** Component/module where error occurred */
  component: string;
  
  /** User ID if applicable */
  userId?: UserId;
  
  /** Request ID for tracing */
  requestId?: string;
  
  /** Additional metadata */
  metadata?: Record<string, unknown>;
  
  /** Timestamp when error occurred */
  timestamp: Date;
}

/**
 * Creates error context with required fields
 */
export function createErrorContext(
  operation: string,
  component: string,
  metadata?: Record<string, unknown>
): ErrorContext {
  const context: ErrorContext = {
    operation,
    component,
    timestamp: new Date(),
  };
  if (metadata !== undefined) {
    context.metadata = metadata;
  }
  return context;
}

// ============================================================================
// Nominal Types for Status/State
// ============================================================================

/** Content lifecycle states */
export type ContentState = 
  | 'draft' 
  | 'published' 
  | 'archived' 
  | 'scheduled' 
  | 'deleted';

/** Publishing job states */
export type PublishingJobState =
  | 'pending'
  | 'in_progress'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'retrying';

/** Notification delivery states */
export type NotificationState =
  | 'pending'
  | 'sent'
  | 'delivered'
  | 'failed'
  | 'bounced'
  | 'suppressed';

/** User roles - P1-13 FIX: Aligned with control-plane/services/auth.ts Role type */
export type UserRole =
  | 'owner'
  | 'admin'
  | 'editor'
  | 'viewer';

// ============================================================================
// Type-Level Utilities
// ============================================================================

/** Makes all properties non-optional (deep) */
export type DeepRequired<T> = T extends object
  ? { [K in keyof T]-?: DeepRequired<T[K]> }
  : T;

/** Makes all properties optional (deep) */
export type DeepPartial<T> = T extends object
  ? { [K in keyof T]?: DeepPartial<T[K]> }
  : T;

/** Type with only the specified keys */
export type PickRequired<T, K extends keyof T> = Required<Pick<T, K>>;

/** Non-empty array type */
export type NonEmptyArray<T> = [T, ...T[]];

/** Ensures at least one property is present */
export type AtLeastOne<T> = {
  [K in keyof T]: Pick<T, K> & Partial<Omit<T, K>>;
}[keyof T];

/** String literal union to type map helper */
export type TypeMap<S extends string, T> = {
  [K in S]: T;
};

// ============================================================================
// Error Code Types
// ============================================================================

/**
 * Standardized error codes for the application.
 * P2-5 FIX: Re-exported from types-base.ts (single source of truth) to prevent drift.
 * The manual union previously here was missing 12 codes present in types-base.ts.
 */
export type { ErrorCode } from './types-base';

// ============================================================================
// Base Validation Error
// ============================================================================

export interface ValidationErrorBase {
  message: string;
  field?: string;
  code: ErrorCode;
}

// ============================================================================
// Facebook Type Guards
// ============================================================================

/**
 * Type guard for Facebook error response
 */
export function isFacebookErrorResponse(value: unknown): value is { error: { message: string; type?: string; code?: number } } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'error' in value &&
    typeof (value as Record<string, unknown>)['error'] === 'object' &&
    (value as Record<string, unknown>)['error'] !== null &&
    'message' in ((value as Record<string, unknown>)['error'] as Record<string, unknown>)
  );
}

/**
 * Type guard for Facebook post response
 */
export function isFacebookPostResponse(value: unknown): value is { id: string; post_id?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof (value as Record<string, unknown>)['id'] === 'string'
  );
}

