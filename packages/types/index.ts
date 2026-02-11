/**
 * Types Package
 * Shared type definitions across the application
 */

// Domain events
export type { DomainEventEnvelope } from './domain-event';

// Branded types - P2-MEDIUM FIX: Export branded types for type safety
export type { 
  OrgId, 
  UserId, 
  ContentId,
  DomainId,
  SessionId,
  CustomerId,
  InvoiceId,
  PaymentId
} from '@kernel/validation/branded';

// Plugin capabilities
export type { PluginCapability, PluginManifest } from './plugin-capabilities';

// Event contracts
export { CONTENT_PUBLISHED_V1, type ContentPublishedV1Payload } from './events/content-published.v1';

// Publishing types (moved from domains/publishing to prevent cross-boundary imports)
export type {
  PublishTargetConfig,
  PublishTargetRetryPolicy,
  PublishTargetAuth,
  PublishTargetRateLimit,
  PublishTargetContentTransform,
} from './publishing';
export { validateTargetConfig } from './publishing';

// Notifications types (moved from domains/notifications to prevent cross-boundary imports)
export type {
  NotificationPayload,
  NotificationAttachment,
  DeliveryResult,
} from './notifications';
export { DeliveryAdapterError } from './notifications';

// ============================================================================
// AUTHENTICATION TYPES - P1-FIX: Centralized AuthContext definition
// ============================================================================
// CANONICAL AuthContext - Single source of truth for authentication context
export type {
  AuthContext,
  UserRole,
} from './auth';

export {
  roleHierarchy,
  hasRole,
  hasAnyRole,
  hasAllRoles,
  getHighestRole,
  requireRole,
  hasRequiredRole,
} from './auth';
