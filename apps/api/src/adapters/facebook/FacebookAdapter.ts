import fetch, { Response as NodeFetchResponse } from 'node-fetch';
import { validateUrlWithDns } from '@security/ssrf';
import { apiConfig, timeoutConfig } from '@config';
import { getLogger } from '@kernel/logger';

const logger = getLogger('FacebookAdapter');

/**
 * Facebook Publishing Adapter
 *
 * LOW FIX L2: Added JSDoc documentation
 * LOW FIX L5: Added proper types
 * MEDIUM FIX M17: Added timeout handling
 * MEDIUM FIX M7: Added health check
 * AUDIT FIX (Finding 4.1): Token redaction in error paths
 * AUDIT FIX (Finding 4.2): Pagination support for Graph API
 * P1 FIX: Added per-attempt retry with fresh AbortControllers
 * P1 FIX: Changed Content-Type to application/x-www-form-urlencoded
 * P2 FIX: Added numeric-only validation to getPageInfo
 * P2 FIX: Capped fetchAllPages total timeout
 */

/**
 * AUDIT FIX (Finding 4.1): Redact access tokens from URLs and error messages
 * to prevent credential leakage in logs, stack traces, or error reporting.
 */
function redactToken(text: string): string {
  return text.replace(/access_token=[^&\s]+/gi, 'access_token=[REDACTED]');
}

/** Maximum pages to fetch to prevent infinite loops on malformed paging data */
const MAX_PAGINATION_PAGES = 100;

/**
 * Maximum total timeout for fetchAllPages: 5 minutes.
 * P2 FIX: The previous limit was timeoutMs * MAX_PAGINATION_PAGES = 30s * 100 = 50 min.
 * A 50-minute timeout is operationally unacceptable. Cap at 5 minutes (300 000 ms) so
 * callers get a timely error and can retry with smaller page sizes.
 */
const MAX_PAGINATION_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/** Maximum retry attempts for transient failures */
const MAX_PUBLISH_RETRIES = 3;

/** Retryable HTTP status codes */
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);

/**
 * Sleep for a given number of milliseconds.
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * API Error with status code and retry information
 */
class ApiError extends Error {
  status: number;
  retryAfter: string | undefined;
  constructor(message: string, status: number, retryAfter?: string) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
    this.name = 'ApiError';
  }
}

/**
 * Validates publish page post input
 * @param pageId - Facebook page ID
 * @param message - Post message content
 * @returns Validated input object
 * @throws Error if validation fails
 */
function validatePublishInput(pageId: string, message: string): { pageId: string; message: string } {
  if (!pageId || typeof pageId !== 'string' || pageId.trim().length === 0) {
    throw new Error('Page ID is required and must be a non-empty string');
  }
  // P0-6 FIX: Enforce numeric-only pageId to prevent path traversal.
  // Without this, pageId='../me/accounts' normalises to /me/accounts/feed,
  // hitting a different Graph API endpoint. The control-plane adapter had this
  // guard; the apps/api copy did not.
  if (!/^\d+$/.test(pageId.trim())) {
    throw new Error('Page ID must be a numeric string (Facebook page ID format)');
  }
  if (!message || typeof message !== 'string') {
    throw new Error('Message is required and must be a string');
  }
  if (message.length > 63206) {
    throw new Error('Message exceeds maximum length of 63,206 characters');
  }
  return { pageId: pageId.trim(), message: message.trim() };
}

/**
 * Type guard for Facebook error response
 * @param data - Unknown data to check
 * @returns True if data is a Facebook error response
 */
function isFacebookErrorResponse(data: unknown): data is { error: { message: string; code: number } } {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const record = data as Record<string, unknown>;
  if (typeof record['error'] !== 'object' || record['error'] === null) {
    return false;
  }
  const errorRecord = record['error'] as Record<string, unknown>;
  return typeof errorRecord['message'] === 'string' && typeof errorRecord['code'] === 'number';
}

/**
 * Type guard for Facebook post response
 * @param data - Unknown data to check
 * @returns True if data is a Facebook post response
 */
function isFacebookPostResponse(data: unknown): data is { id: string } {
  return (
    typeof data === 'object' &&
    data !== null &&
    typeof (data as Record<string, unknown>)['id'] === 'string'
  );
}

/**
 * Type guard for Facebook page info response
 * P1-5 FIX: Separate type guard that validates both id and name fields
 */
function isFacebookPageInfoResponse(data: unknown): data is { id: string; name: string | undefined } {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const record = data as Record<string, unknown>;
  return (
    typeof record['id'] === 'string' &&
    (record['name'] === undefined || typeof record['name'] === 'string')
  );
}

/**
 * Facebook Graph API Adapter
 * @class FacebookAdapter
 */

export interface FacebookPostResponse {
  id: string;
  post_id: string | undefined;
}

export interface FacebookHealthStatus {
  healthy: boolean;
  latency: number;
  error: string | undefined;
}

export interface FacebookErrorResponse {
  error: {
    message: string;
    type: string;
    code: number;
    fbtrace_id: string | undefined;
  } | undefined;
}

export interface PublishPagePostInput {
  pageId: string;
  message: string;
}

/**
 * AUDIT FIX (Finding 4.2): Facebook paginated response structure
 */
export interface FacebookPaginatedResponse<T> {
  data: T[];
  paging?: {
    cursors?: { before?: string; after?: string };
    next?: string;
    previous?: string;
  };
}

function isFacebookPaginatedResponse(data: unknown): data is FacebookPaginatedResponse<unknown> {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  return Array.isArray(record['data']);
}

export class FacebookAdapter {
  private readonly accessToken: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  /**
   * Creates an instance of FacebookAdapter
   * @param accessToken - Facebook page access token
   * @throws Error if accessToken is empty
   */
  constructor(accessToken: string) {
    if (!accessToken || typeof accessToken !== 'string') {
      throw new Error('Facebook access token is required and must be a string');
    }
    this.accessToken = accessToken;
    // M24 FIX: Use config rather than hardcoded URL so staging/prod environments
    // can use different Graph API versions without a code change.
    this.baseUrl = `${apiConfig.baseUrls.facebook}/${apiConfig.versions.facebook}`;
    this.timeoutMs = timeoutConfig.long;
  }

  /**
   * Publish a post to a Facebook page
   *
   * P1 FIX: Added per-attempt retry with fresh AbortControllers.
   * The previous code had no retry logic: a single transient 429/5xx caused
   * permanent failure. Each retry now gets its own AbortController so a
   * timeout on attempt N doesn't abort the signal for attempt N+1.
   *
   * P1 FIX: Changed Content-Type from application/json to
   * application/x-www-form-urlencoded. The Facebook Graph API /feed endpoint
   * does not accept JSON bodies; sending JSON produces a silent 200 with no post
   * created or an API-level error wrapped in a 200 response.
   *
   * @param pageId - Facebook page ID (numeric string)
   * @param message - Post message content
   * @returns Facebook post response with ID
   * @throws Error if publish fails or input is invalid
   */
  async publishPagePost(pageId: string, message: string): Promise<FacebookPostResponse> {
    // Validate inputs
    const validatedInput = validatePublishInput(pageId, message);

    // P0-6 FIX: SSRF protection — validate the constructed URL against internal
    // network ranges and DNS before making the request.
    const targetUrl = `${this.baseUrl}/${validatedInput.pageId}/feed`;
    const ssrfCheck = await validateUrlWithDns(targetUrl);
    if (!ssrfCheck.allowed) {
      // P1 FIX: Do not include ssrfCheck.reason in the thrown error. The reason
      // describes exactly why the URL was blocked (e.g., "DNS resolved to private IP
      // 192.168.1.1"), giving an attacker iterative feedback for bypass attempts.
      // Log internally; throw a generic message that reveals nothing about the policy.
      // (The logger auto-redacts sensitive fields per @kernel/logger configuration.)
      logger.error('SSRF check blocked Facebook API request', new Error(`SSRF: ${ssrfCheck.reason}`));
      throw new Error('Facebook API request blocked by security policy');
    }

    let lastError: Error = new Error('Facebook publish: no attempts made');

    for (let attempt = 0; attempt <= MAX_PUBLISH_RETRIES; attempt++) {
      // P1 FIX: Fresh AbortController per attempt so a prior timeout cannot
      // abort subsequent retries.
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        // P1 FIX: Use application/x-www-form-urlencoded — the correct encoding
        // for Facebook Graph API /feed POST requests.
        const res = await fetch(targetUrl, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({ message: validatedInput['message'] }),
          signal: controller.signal,
        });

        if (!res.ok) {
          const errorBody = await res.text();

          // Respect Retry-After on 429
          if (res.status === 429 && attempt < MAX_PUBLISH_RETRIES) {
            const retryAfter = res.headers.get('retry-after');
            const delayMs = retryAfter ? parseInt(retryAfter, 10) * 1000 : 1000 * Math.pow(2, attempt);
            lastError = new ApiError(`Facebook rate limited: ${res.status}`, res.status, retryAfter ?? undefined);
            clearTimeout(timeout);
            await sleep(delayMs);
            continue;
          }

          // Retry on transient server errors
          if (RETRYABLE_STATUSES.has(res.status) && attempt < MAX_PUBLISH_RETRIES) {
            const delayMs = 1000 * Math.pow(2, attempt);
            lastError = new Error(`Facebook publish failed: ${res.status}`);
            clearTimeout(timeout);
            await sleep(delayMs);
            continue;
          }

          let errorMessage = `Facebook publish failed: ${res.status}`;
          try {
            const errorData = JSON.parse(errorBody) as unknown;
            if (isFacebookErrorResponse(errorData)) {
              errorMessage = `Facebook publish failed: ${errorData.error['message']} (code: ${errorData.error.code})`;
            }
          } catch {
            // AUDIT FIX (Finding 4.1): Redact tokens from error body before including in message
            errorMessage = `Facebook publish failed: ${res.status} - ${redactToken(errorBody)}`;
          }
          throw new Error(redactToken(errorMessage));
        }

        const rawData = await res.json() as unknown;
        if (!rawData || typeof rawData !== 'object' || !isFacebookPostResponse(rawData)) {
          throw new ApiError('Invalid response format from Facebook API', 500);
        }
        const data: FacebookPostResponse = {
          id: rawData.id,
          post_id: (rawData as Record<string, unknown>)['post_id'] as string | undefined,
        };
        if (!data.id) {
          throw new Error('Facebook API response missing post ID');
        }
        return data;
      } catch (error) {
        clearTimeout(timeout);
        if (error instanceof Error) {
          // Timeout — retry unless we've exhausted attempts
          if (error.name === 'AbortError') {
            lastError = new Error('Facebook publish request timed out');
            if (attempt < MAX_PUBLISH_RETRIES) {
              await sleep(1000 * Math.pow(2, attempt));
              continue;
            }
            throw lastError;
          }
          // AUDIT FIX (Finding 4.1): Ensure no token leakage in re-thrown errors
          if (error.message.includes('access_token')) {
            throw new Error(redactToken(error.message));
          }
          throw error;
        }
        throw new Error('Unknown error during Facebook publish');
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError;
  }

  /**
   * Health check for Facebook API connection
   * MEDIUM FIX M7: Health check for external services
   *
   * @returns Health status with latency
   */
  async healthCheck(): Promise<FacebookHealthStatus> {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(`${this.baseUrl}/me`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
        signal: controller.signal,
      });
      // P1-2 FIX: Only 2xx status codes indicate healthy service
      // A 401 means the token is expired/revoked -- not healthy
      const healthy = res.ok;
      const result: FacebookHealthStatus = {
        healthy,
        latency: Date.now() - start,
        error: healthy ? undefined : `Unexpected status: ${res.status}`,
      };
      return result;
    }
    catch (error) {
      const result: FacebookHealthStatus = {
        healthy: false,
        latency: Date.now() - start,
        // AUDIT FIX (Finding 4.1): Redact tokens from health check errors
        error: error instanceof Error ? redactToken(error.message) : 'Unknown error',
      };
      return result;
    }
    finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Get page information
   * @param pageId - Facebook page ID (numeric string)
   * @returns Page information
   * @throws Error if request fails
   *
   * P2 FIX: Added numeric-only validation for pageId. Without this guard,
   * pageId='../me/accounts' would construct a URL traversing to a different
   * Graph API endpoint, allowing callers to probe arbitrary endpoints.
   */
  async getPageInfo(pageId: string): Promise<{ id: string; name: string | undefined }> {
    if (!pageId || typeof pageId !== 'string') {
      throw new Error('Page ID is required and must be a string');
    }
    // P2 FIX: Enforce numeric-only pageId (matches validatePublishInput constraint)
    if (!/^\d+$/.test(pageId.trim())) {
      throw new Error('Page ID must be a numeric string (Facebook page ID format)');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/${pageId.trim()}?fields=id,name`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
        // AUDIT FIX (Finding 4.1): Status-only error, no URL/token leakage
        throw new Error(`Failed to get page info: ${res.status}`);
      }
      const rawData = await res.json() as unknown;
      if (!isFacebookPageInfoResponse(rawData)) {
        throw new ApiError('Invalid page info response format from Facebook API', 500);
      }
      return {
        id: rawData.id,
        name: rawData.name,
      };
    }
    catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Get page info request timed out');
      }
      throw error;
    }
    finally {
      clearTimeout(timeout);
    }
  }

  /**
   * AUDIT FIX (Finding 4.2): Fetch all pages of a paginated Graph API endpoint.
   *
   * Facebook API returns data in pages (default ~25 items). Without consuming
   * all pages, callers silently drop data beyond the first page.
   *
   * @param endpoint - Graph API endpoint path (e.g., `${pageId}/feed`)
   * @param fields - Comma-separated fields to request
   * @param limit - Per-page limit (max 100 per Facebook docs)
   * @returns All items across all pages
   *
   * P2 FIX: Total timeout capped at MAX_PAGINATION_TIMEOUT_MS (5 min) rather than
   * timeoutMs * MAX_PAGINATION_PAGES (= 50 min). A 50-minute timeout is operationally
   * unacceptable and delays error detection significantly.
   */
  async fetchAllPages<T>(
    endpoint: string,
    fields?: string,
    limit = 100,
  ): Promise<T[]> {
    const allItems: T[] = [];
    let url: string | undefined =
      `${this.baseUrl}/${endpoint}?limit=${limit}${fields ? `&fields=${fields}` : ''}`;
    let pageCount = 0;

    const controller = new AbortController();
    const loopTimeout = setTimeout(() => controller.abort(), MAX_PAGINATION_TIMEOUT_MS);

    try {
      while (url && pageCount < MAX_PAGINATION_PAGES) {
        pageCount++;

        const res: NodeFetchResponse = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${this.accessToken}`,
          },
          signal: controller.signal,
        });

        if (!res.ok) {
          throw new Error(`Facebook API request failed: ${res.status}`);
        }

        const rawData = await res.json() as unknown;
        if (!isFacebookPaginatedResponse(rawData)) {
          throw new ApiError('Invalid paginated response format from Facebook API', 500);
        }

        allItems.push(...(rawData.data as T[]));

        // Follow next page link if available
        url = rawData.paging?.next;
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('Facebook paginated fetch request timed out');
      }
      // AUDIT FIX (Finding 4.1): Redact tokens from pagination errors
      if (error instanceof Error && error.message.includes('access_token')) {
        throw new Error(redactToken(error.message));
      }
      throw error;
    } finally {
      clearTimeout(loopTimeout);
    }

    return allItems;
  }
}
