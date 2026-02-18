/**
* Publishing Types Package
* Shared types for publishing adapters
*
* This package provides centralized publishing types to prevent
* cross-boundary imports between plugins and domains.
*/

/**
 * Full publish target configuration including credentials.
 * P0-FIX: This type MUST NOT be embedded in BullMQ job payloads or any
 * data structure that is serialized to Redis or logs. Credentials must be
 * resolved at execution time from a secrets store, never queued.
 * Use PublishJobPayload for job queue entries instead.
 */
export interface PublishTargetConfig {
  url?: string;
  token?: string;
  apiKey?: string;
  webhook?: string;
  options?: Record<string, unknown>;
}

/**
 * Job queue payload — safe to serialize to Redis/BullMQ.
 * P0-FIX: Replaces PublishInput for all job-queue use. Credentials are
 * referenced by a credentialRef ID and resolved at execution time from the
 * secrets vault; they are never stored in the queue payload.
 */
export interface PublishJobPayload {
  domainId: string;
  contentId: string;
  targetId: string;
  /** Opaque reference resolved to credentials at execution time — never the credential itself */
  credentialRef: string;
}

/**
 * @deprecated Use PublishJobPayload for job queues to avoid storing secrets in Redis.
 * PublishInput (with embedded targetConfig) may only be used for in-process calls
 * where credentials are resolved and passed directly without serialization.
 */
export interface PublishInput {
  domainId: string;
  contentId: string;
  targetConfig: PublishTargetConfig;
}

export interface PublishAdapter {
  publish(input: PublishInput): Promise<void>;
}

/**
 * Type guard to check if unknown value is a valid PublishTargetConfig
 * @param config - Value to check
 * @returns True if value is a valid PublishTargetConfig
 */
export function isPublishTargetConfig(config: unknown): config is PublishTargetConfig {
  if (typeof config !== 'object' || config === null) {
    return false;
  }
  const cfg = config as Record<string, unknown>;

  if (cfg["url"] !== undefined && typeof cfg["url"] !== 'string') {
    return false;
  }
  if (cfg["token"] !== undefined && typeof cfg["token"] !== 'string') {
    return false;
  }
  if (cfg["apiKey"] !== undefined && typeof cfg["apiKey"] !== 'string') {
    return false;
  }
  if (cfg["webhook"] !== undefined && typeof cfg["webhook"] !== 'string') {
    return false;
  }
  return true;
}

/**
 * Validates target config and throws if invalid
 * @param config - Config to validate
 * @throws Error if config is invalid
 */
export function validateTargetConfig(config: unknown): asserts config is PublishTargetConfig {
  if (!isPublishTargetConfig(config)) {
    throw new Error('Invalid target config: validation failed');
  }
}

/**
* Retry policy for publish targets
* Defines how retries should be handled for failed publishes
*/
export interface PublishTargetRetryPolicy {
  maxRetries: number;
  backoffMultiplier: number;
  initialDelayMs: number;
  maxDelayMs: number;
}

/**
* Authentication configuration for publish targets
*/
export interface PublishTargetAuth {
  type: 'apiKey' | 'oauth' | 'basic' | 'bearer';
  credentials: Record<string, string>;
}

/**
* Rate limiting configuration for publish targets
*/
export interface PublishTargetRateLimit {
  maxRequestsPerSecond: number;
  maxRequestsPerMinute: number;
  maxRequestsPerHour: number;
}

/**
* Content transformation configuration for publish targets
* Defines how content should be transformed before publishing
*/
export interface PublishTargetContentTransform {
  format: 'html' | 'markdown' | 'plain' | 'json';
  sanitize: boolean;
  includeMetadata: boolean;
  customFields?: Record<string, string>;
}
