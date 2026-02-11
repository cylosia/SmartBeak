/**
* Publishing Types Package
* Shared types for publishing adapters
*
* This package provides centralized publishing types to prevent
* cross-boundary imports between plugins and domains.
*/

export interface PublishTargetConfig {
  url?: string;
  token?: string;
  apiKey?: string;
  webhook?: string;
  options?: Record<string, unknown>;
}

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
