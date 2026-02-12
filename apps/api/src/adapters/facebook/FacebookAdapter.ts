import { timeoutConfig } from '@config';
import fetch from 'node-fetch';

/**
 * Facebook Publishing Adapter
 *
 * LOW FIX L2: Added JSDoc documentation
 * LOW FIX L5: Added proper types
 * MEDIUM FIX M17: Added timeout handling
 * MEDIUM FIX M7: Added health check
 */

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

export class FacebookAdapter {
  private readonly accessToken: string;
  private readonly baseUrl = 'https://graph.facebook.com/v19.0';
  private readonly timeoutMs = 30000;

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
  }

  /**
   * Publish a post to a Facebook page
   *
   * @param pageId - Facebook page ID
   * @param message - Post message content
   * @returns Facebook post response with ID
   * @throws Error if publish fails or input is invalid
   */
  async publishPagePost(pageId: string, message: string): Promise<FacebookPostResponse> {
    // Validate inputs
    const validatedInput = validatePublishInput(pageId, message);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/${validatedInput.pageId}/feed`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: validatedInput["message"] }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const errorBody = await res.text();
        let errorMessage = `Facebook publish failed: ${res.status}`;
        try {
          const errorData = JSON.parse(errorBody);
          if (isFacebookErrorResponse(errorData)) {
            errorMessage = `Facebook publish failed: ${errorData.error["message"]} (code: ${errorData.error.code})`;
          }
        }
        catch {
          // Use status-based error message if parsing fails
          errorMessage = `Facebook publish failed: ${res.status} - ${errorBody}`;
        }
        throw new Error(errorMessage);
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
    }
    catch (error) {
      if (error instanceof Error) {
        // Re-throw abort error as timeout error
        if (error.name === 'AbortError') {
          throw new Error('Facebook publish request timed out');
        }
        throw error;
      }
      throw new Error('Unknown error during Facebook publish');
    }
    finally {
      clearTimeout(timeout);
    }
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
        error: error instanceof Error ? error["message"] : 'Unknown error',
      };
      return result;
    }
    finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Get page information
   * @param pageId - Facebook page ID
   * @returns Page information
   * @throws Error if request fails
   */
  async getPageInfo(pageId: string): Promise<{ id: string; name: string | undefined }> {
    if (!pageId || typeof pageId !== 'string') {
      throw new Error('Page ID is required and must be a string');
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/${pageId}?fields=id,name`, {
        headers: {
          'Authorization': `Bearer ${this.accessToken}`,
        },
        signal: controller.signal,
      });
      if (!res.ok) {
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
}
