import { URL } from 'url';
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
 * Active fetch controllers for request cancellation
 * Maps request IDs to AbortControllers
 */
const activeControllers = new Map<string, AbortController>();

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
  activeControllers.set(requestId, controller);
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
  const controller = activeControllers.get(requestId);
  if (controller) {
    controller.abort();
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
  for (const [id, controller] of activeControllers) {
    controller.abort();
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

    const config = target.config as unknown as WebhookConfig;

    // SECURITY FIX: Issue 1 - SSRF protection using centralized utility
    const urlValidation = validateUrl(config["url"], { requireHttps: true });
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
          case 'basic':
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
          case 'api-key':
            if (config.auth.keyHeader && config.auth.token) {
              headers[config.auth.keyHeader] = config.auth.token;
            }
            break;
        }
      }

      // SECURITY FIX: Issue 17 - Add request timeout using AbortController
      // SECURITY FIX: Issue 18 - Register controller for cancellation support
      const requestId = generateRequestId();
      const controller = new AbortController();
      registerRequestController(requestId, controller);

      const timeoutId = setTimeout(() => controller.abort(), PUBLISHING_TIMEOUT_MS);

      try {
        const response = await fetch(config["url"], {
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
          throw new FetchTimeoutError(`Request to ${config["url"]} timed out after ${PUBLISHING_TIMEOUT_MS}ms`);
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
