import { randomBytes } from 'crypto';

import { PublishingAdapter, PublishingContent, PublishingTarget, PublishResult } from './PublishingAdapter';
import { validateUrl } from '@security/ssrf';

/**
* Web Publishing Adapter
* Publishes content to generic webhooks or APIs
*/

// SECURITY FIX: Request timeout configuration
const PUBLISHING_TIMEOUT_MS = 30000; // 30 seconds

/**
 * Error thrown when fetch request times out
 */
export class FetchTimeoutError extends Error {
  constructor(message = 'Request timeout') {
    super(message);
    this.name = 'FetchTimeoutError';
  }
}

/**
* SECURITY FIX: Issue 1 - SSRF protection using centralized utility
* Prevents SSRF attacks by blocking requests to internal network resources
*/

export interface WebhookPayload {
  title: string;
  body: string;
  excerpt?: string | undefined;
  featuredImage?: string | undefined;
  tags?: string[] | undefined;
  categories?: string[] | undefined;
  meta?: Record<string, unknown> | undefined;
  timestamp: string;
}

export interface WebhookConfig {
  url: string;
  method?: 'POST' | 'PUT' | 'PATCH' | undefined;
  headers?: Record<string, string> | undefined;
  auth?: {
    type: 'bearer' | 'basic' | 'api-key';
    token?: string | undefined;
    username?: string | undefined;
    password?: string | undefined;
    keyHeader?: string | undefined;
  } | undefined;
}

/**
 * P0-3 SECURITY FIX: Allowlist for api-key header names to prevent header injection.
 * Only these header names are accepted for api-key auth keyHeader.
 */
const ALLOWED_API_KEY_HEADERS = new Set([
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-secret-key',
  'x-webhook-key',
  'x-custom-key',
  'api-key',
  'apikey',
]);

/**
 * P2-1 FIX: Bounded active controllers map with max size to prevent memory leak
 */
const MAX_ACTIVE_CONTROLLERS = 10000;

/**
 * Active fetch controllers for request cancellation
 * Maps request IDs to AbortControllers
 */
const activeControllers = new Map<string, { controller: AbortController; createdAt: number }>();

/** P1-14 FIX: Periodic cleanup of stale controllers older than 5 minutes */
const CONTROLLER_MAX_AGE_MS = 5 * 60 * 1000;
const CONTROLLER_CLEANUP_INTERVAL_MS = 60 * 1000;

const controllerCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [id, entry] of activeControllers) {
    if (now - entry.createdAt > CONTROLLER_MAX_AGE_MS) {
      entry.controller.abort();
      activeControllers.delete(id);
    }
  }
}, CONTROLLER_CLEANUP_INTERVAL_MS);
if (controllerCleanupInterval.unref) {
  controllerCleanupInterval.unref();
}

/**
 * Generate a unique request ID
 */
function generateRequestId(): string {
  return `${Date.now()}-${randomBytes(16).toString('hex')}`;
}

/**
 * Register a controller for potential cancellation
 * SECURITY FIX: Issue 18 - Request cancellation on unmount
 */
export function registerRequestController(requestId: string, controller: AbortController): void {
  // P2-1 FIX: Prevent unbounded memory growth
  if (activeControllers.size >= MAX_ACTIVE_CONTROLLERS) {
    // Evict oldest entry
    const oldest = activeControllers.keys().next().value;
    if (oldest !== undefined) {
      activeControllers.delete(oldest);
    }
  }
  activeControllers.set(requestId, { controller, createdAt: Date.now() });
}

/**
 * Unregister a controller when request completes
 */
export function unregisterRequestController(requestId: string): void {
  activeControllers.delete(requestId);
}

/**
 * Cancel a specific request by ID
 * @param requestId - The request ID to cancel
 * @returns true if request was found and cancelled
 */
export function cancelRequest(requestId: string): boolean {
  const entry = activeControllers.get(requestId);
  if (entry) {
    entry.controller.abort();
    activeControllers.delete(requestId);
    return true;
  }
  return false;
}

/**
 * Cancel all active requests
 * Useful for cleanup on unmount
 */
export function cancelAllRequests(): number {
  let count = 0;
  for (const [id, entry] of activeControllers) {
    entry.controller.abort();
    activeControllers.delete(id);
    count++;
  }
  return count;
}

/**
* Web publishing adapter

*/
export class WebPublishingAdapter extends PublishingAdapter {
  readonly targetType = 'webhook';

  /**
  * Validate webhook configuration

  */
  validateConfig(config: Record<string, unknown>): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!config["url"] || typeof config["url"] !== 'string') {
      errors.push('URL is required');
    } else {
      // SECURITY FIX: Issue 1 & 21 - Use centralized SSRF validation and HTTPS enforcement
      const urlValidation = validateUrl(config["url"], { requireHttps: true });
      if (!urlValidation.allowed) {
        errors.push(urlValidation.reason || 'Invalid URL');
      }
    }

    if (config["method"] && !['POST', 'PUT', 'PATCH'].includes(config["method"] as string)) {
      errors.push('Method must be POST, PUT, or PATCH');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
  * Publish content via webhook

  */
  async publish(content: PublishingContent, target: PublishingTarget): Promise<PublishResult> {
    const configValidation = this.validateConfig(target.config);
    if (!configValidation.valid) {
      return {
        success: false,
        error: `Invalid configuration: ${configValidation.errors.join(', ')}`,
        timestamp: new Date(),
      };
    }

    // P2-2 FIX: Validate config shape before unsafe cast
    const rawConfig = target.config;
    if (typeof rawConfig["url"] !== 'string') {
      return { success: false, error: 'Invalid config: url must be a string', timestamp: new Date() };
    }
    const config: WebhookConfig = {
      url: rawConfig["url"],
      method: rawConfig["method"] as WebhookConfig['method'],
      headers: rawConfig["headers"] as WebhookConfig['headers'],
      auth: rawConfig["auth"] as WebhookConfig['auth'],
    };

    // SECURITY FIX: Issue 1 - SSRF protection using centralized utility
    const urlValidation = validateUrl(config.url, { requireHttps: true });
    if (!urlValidation.allowed) {
      return {
        success: false,
        error: `SSRF protection: ${urlValidation.reason}`,
        timestamp: new Date(),
      };
    }

    const payload = this.buildPayload(content);

    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        ...config.headers,
      };

      // Add authentication headers
      if (config.auth) {
        switch (config.auth.type) {
          case 'bearer':
            headers['Authorization'] = `Bearer ${config.auth.token}`;
            break;
          case 'basic': {
            // SECURITY FIX: Issue 5 - Validate username and password are defined before Buffer.from()
            if (!config.auth.username || !config.auth.password) {
              return {
                success: false,
                error: 'Basic auth requires both username and password',
                timestamp: new Date(),
              };
            }
            const auth = Buffer.from(`${config.auth.username}:${config.auth.password}`).toString('base64');
            headers['Authorization'] = `Basic ${auth}`;
            break;
          }
          case 'api-key':
            // P0-3 SECURITY FIX: Validate keyHeader against allowlist to prevent header injection
            if (config.auth.keyHeader && config.auth.token) {
              const normalizedHeader = config.auth.keyHeader.toLowerCase();
              if (!ALLOWED_API_KEY_HEADERS.has(normalizedHeader)) {
                return {
                  success: false,
                  error: `Invalid api-key header name: ${config.auth.keyHeader}. Allowed: ${[...ALLOWED_API_KEY_HEADERS].join(', ')}`,
                  timestamp: new Date(),
                };
              }
              headers[config.auth.keyHeader] = config.auth.token;
            }
            break;
          // P2-3 FIX: Exhaustive switch — reject unknown auth types
          default: {
            const unknownType: string = config.auth.type;
            return {
              success: false,
              error: `Unknown auth type: ${unknownType}`,
              timestamp: new Date(),
            };
          }
        }
      }

      // SECURITY FIX: Issue 17 - Add request timeout using AbortController
      // SECURITY FIX: Issue 18 - Register controller for cancellation support
      const requestId = generateRequestId();
      const controller = new AbortController();
      registerRequestController(requestId, controller);

      const timeoutId = setTimeout(() => controller.abort(), PUBLISHING_TIMEOUT_MS);

      try {
        // P0-5 FIX: Use sanitizedUrl from SSRF validation instead of original config URL (TOCTOU)
        const response = await fetch(urlValidation.sanitizedUrl!, {
          method: config["method"] || 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        unregisterRequestController(requestId);

        if (!response.ok) {
          return {
            success: false,
            error: `Webhook returned ${response.status}: ${response.statusText}`,
            timestamp: new Date(),
          };
        }

        const responseData = await response.json() as { id?: string; url?: string };

        return {
          success: true,
          publishedId: responseData.id,
          publishedUrl: responseData['url'],
          timestamp: new Date(),
          requestId, // Include requestId for potential cancellation
        };
      } catch (fetchError) {
        clearTimeout(timeoutId);
        unregisterRequestController(requestId);
        if (fetchError instanceof Error && fetchError.name === 'AbortError') {
          throw new FetchTimeoutError(`Webhook request timed out after ${PUBLISHING_TIMEOUT_MS}ms`);
        }
        throw fetchError;
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error["message"] : 'Webhook request failed',
        timestamp: new Date(),
      };
    }
  }

  /**
  * Build webhook payload

  */
  private buildPayload(content: PublishingContent): WebhookPayload {
    return {
      title: content.title,
      body: content.body,
      excerpt: content.excerpt,
      featuredImage: content.featuredImage,
      tags: content.tags,
      categories: content.categories,
      meta: content.meta,
      timestamp: new Date().toISOString(),
    };
  }
}
