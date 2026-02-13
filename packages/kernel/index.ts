

/**
 * Kernel Package
 * Core utilities for resilience, chaos engineering, and safe async handling
 *
 * LOW FIX L2: Added comprehensive exports
 */
// Existing exports
export { maybeChaos } from './chaos';
export { EventBus } from './event-bus';
export { runSafely } from './safe-handler';
export { generateDnsToken, verifyDns, verifyDnsMulti, getDnsTxtRecords, } from './dns';
export { DLQService, RegionWorker, DEFAULT_QUEUE_CONFIG } from './queue';
// NEW EXPORTS for medium and low priority fixes
// Request context (M4)
export { getRequestContext, runWithContext, createRequestContext, getRequestId, getElapsedMs, createChildContext, } from './request-context';
// Validation utilities (M2, M5, M18, M21)
export { 
  isValidUUID, 
  validateUUID, 
  ValidationError, 
  PaginationQuerySchema, 
  SearchQuerySchema, 
  sanitizeSearchQuery, 
  validateArrayLength, 
  validateStringLength, 
  DateRangeSchema, 
  normalizeDate, 
  MoneyCentsSchema, 
  dollarsToCents, 
  centsToDollars, 
  UrlSchema,
  validateEnum,
  validateNonEmptyString,
  isValidDate,
  ErrorCodes,
} from './validation';
// Structured logger (L4, M19)
export { addLogHandler, clearLogHandlers, debug, info, warn, error, fatal, Logger, getLogger, } from './logger';
// Constants (M6)
export { TIME, TIME_SECONDS, DB, RATE_LIMIT, HTTP, CONTENT, JOBS, CACHE, SECURITY, VALIDATION, PAGINATION, } from './constants';
// Health checks (M7, M11)
export { registerHealthCheck, checkAllHealth, getLastHealthCheck, createDatabaseHealthCheck, createExternalApiHealthCheck, createRedisHealthCheck, healthCheckMiddleware, } from './health-check';
// Retry utilities (M8)
export { withRetry, makeRetryable, Retryable, CircuitBreaker, } from './retry';
// DLQ (M15)
export { setDLQStorage, getDLQStorage, sendToDLQ, DLQ, withDLQ, } from './dlq';
// Metrics (M5)
export { emitMetric, emitTimer, emitCounter, emitGauge, addMetricHandler, clearMetricHandlers, } from './metrics';
// Branded Types (ARCH-9): Type-safe identifiers to prevent ID confusion
// Export runtime functions
export {
  createOrgId, createUserId, createDomainId, createContentId,
  createEmailSubscriberId, createJobId, createPaymentId, createSubscriptionId,
  createMediaAssetId, createAuditEventId, unsafeBrand,
  isValidId, isOrgId, isUserId, isDomainId,
} from './branded';
// Export types
export type {
  Brand,
  OrgId, UserId, MembershipId, DomainId, DomainRegistryId,
  ContentId, ContentVersionId, ContentIdeaId, MediaAssetId, MediaCollectionId,
  EmailSubscriberId, EmailCampaignId, EmailTemplateId,
  JobId, TaskId, ExportId, AnalyticsEventId, MetricId, ReportId,
  SubscriptionId, InvoiceId, PaymentId, AffiliateId, CommissionId,
  AuditEventId, SessionId, ApiKeyId,
} from './branded';

// P0-FIX: Distributed locking for preventing race conditions
export {
  acquireLock, acquireLockWithRetry, releaseLock, extendLock, withLock,
  isLocked, getLockInfo,
  type Lock, type LockOptions,
} from './redlock';

// P0-FIX: Distributed rate limiting using Redis
export {
  checkRateLimit, checkBurstRateLimit, getRateLimitStatus, resetRateLimit,
  rateLimitMiddleware, createRateLimiter,
  type RateLimitConfig, type RateLimitResult,
} from './rateLimiterRedis';

// Transactional outbox relay for at-least-once event delivery
export { OutboxRelay, type OutboxRelayOptions } from './outbox/OutboxRelay';
