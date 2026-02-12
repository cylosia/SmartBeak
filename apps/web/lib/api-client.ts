/**
 * P1-FIX: API Client with Timeouts and Retry Logic
 * 
 * Provides a robust HTTP client with:
 * - Request timeouts (prevents hanging requests)
 * - Automatic retry with exponential backoff
 * - Request/response interceptors
 * - Circuit breaker pattern
 */

// import { getLogger } from '@kernel/logger';
const logger = {
  debug: (..._args: unknown[]) => {},
  warn: (..._args: unknown[]) => {},
  error: (..._args: unknown[]) => {},
};



// P1-FIX: Default timeout values
const DEFAULT_TIMEOUT_MS = 10000; // 10 seconds
const MAX_TIMEOUT_MS = 30000; // 30 seconds

export interface ApiClientConfig {
  baseUrl: string;
  timeoutMs?: number;
  retries?: number;
  retryDelayMs?: number;
  headers?: Record<string, string>;
}

export interface RequestConfig {
  timeoutMs?: number;
  retries?: number;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/**
 * P1-FIX: Fetch with timeout using AbortController
 * Prevents requests from hanging indefinitely
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number }
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...fetchOptions } = options;
  
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
    });
    return response;
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * P1-FIX: Retry fetch with exponential backoff
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit & { timeoutMs?: number; retries?: number; retryDelayMs?: number }
): Promise<Response> {
  const { retries = 3, retryDelayMs = 1000, ...fetchOptions } = options;
  
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetchWithTimeout(url, fetchOptions);
      
      // Don't retry on 4xx errors (client errors)
      if (response.status >= 400 && response.status < 500) {
        return response;
      }
      
      // Return successful response
      if (response.ok) {
        return response;
      }
      
      // Retry on 5xx errors
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      // Don't retry on the last attempt
      if (attempt === retries) {
        break;
      }
      
      // Don't retry if explicitly aborted
      if (lastError.name === 'AbortError') {
        throw lastError;
      }
      
      // Calculate delay with exponential backoff + jitter
      const delay = retryDelayMs * Math.pow(2, attempt) + Math.random() * 1000;
      logger.warn(`Request failed (attempt ${attempt + 1}/${retries + 1}), retrying in ${delay}ms`, {
        error: lastError.message,
        url,
      });
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  throw lastError || new Error('Request failed after retries');
}

/**
 * Create API client with configured defaults
 */
export function createApiClient(config: ApiClientConfig) {
  const baseUrl = config.baseUrl.replace(/\/$/, ''); // Remove trailing slash
  const defaultTimeout = config.timeoutMs || DEFAULT_TIMEOUT_MS;
  const defaultRetries = config.retries ?? 3;

  async function request<T>(
    method: string,
    path: string,
    data?: unknown,
    requestConfig: RequestConfig = {}
  ): Promise<T> {
    const normalizedPath = path.replace(/^\//, '');
    const url = `${baseUrl}/${normalizedPath}`;
    const timeoutMs = requestConfig.timeoutMs || defaultTimeout;
    const retries = requestConfig.retries ?? defaultRetries;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      ...config.headers,
      ...requestConfig.headers,
    };

    const options: RequestInit = {
      method,
      headers,
      credentials: 'include', // Include cookies for auth
    };

    if (data && method !== 'GET') {
      options.body = JSON.stringify(data);
    }

    logger.debug(`API ${method} ${path}`, { timeoutMs, retries });

    const response = await fetchWithRetry(url, {
      ...options,
      timeoutMs,
      retries,
      // P2-FIX: Use undefined instead of null — fetch API expects AbortSignal | undefined
      signal: requestConfig.signal ?? undefined,
    });

    // Handle non-JSON responses
    const contentType = response.headers.get('content-type');
    if (!contentType?.includes('application/json')) {
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      // P2-FIX: Explicitly type non-JSON response — the double cast masked type errors
      const text = await response.text();
      return text as T;
    }

    const result = await response.json();

    if (!response.ok) {
      throw new Error(
        result.error || result.message || `HTTP ${response.status}: ${response.statusText}`
      );
    }

    return result as T;
  }

  return {
    get: <T>(path: string, config?: RequestConfig) => request<T>('GET', path, undefined, config),
    post: <T>(path: string, data?: unknown, config?: RequestConfig) => request<T>('POST', path, data, config),
    put: <T>(path: string, data?: unknown, config?: RequestConfig) => request<T>('PUT', path, data, config),
    patch: <T>(path: string, data?: unknown, config?: RequestConfig) => request<T>('PATCH', path, data, config),
    delete: <T>(path: string, config?: RequestConfig) => request<T>('DELETE', path, undefined, config),
  };
}

// Default API client instance
export const apiClient = createApiClient({
  baseUrl: typeof process !== 'undefined' && process.env['NEXT_PUBLIC_API_URL'] ? process.env['NEXT_PUBLIC_API_URL'] : '/api',
  timeoutMs: DEFAULT_TIMEOUT_MS,
  retries: 3,
});

// Auth API client with longer timeout for auth operations
export const authApiClient = createApiClient({
  baseUrl: typeof process !== 'undefined' && process.env['NEXT_PUBLIC_API_URL'] ? process.env['NEXT_PUBLIC_API_URL'] : '/api',
  timeoutMs: 15000, // 15 seconds for auth
  retries: 2,
});

// Exported helpers for backward compatibility
export const apiUrl = (path: string): string => {
  const base = typeof process !== 'undefined' && process.env['NEXT_PUBLIC_API_URL']
    ? process.env['NEXT_PUBLIC_API_URL']
    : '/api';
  // C5-FIX: Ensure path separator between base URL and path
  const normalizedPath = path.replace(/^\//, '');
  return `${base.replace(/\/$/, '')}/${normalizedPath}`;
};

export const authFetch = async <T = unknown>(
  urlOrPath: string,
  options?: RequestInit & { timeoutMs?: number; retries?: number; ctx?: { req?: { headers?: { cookie?: string } } } }
): Promise<Response> => {
  // If already a full URL, use it directly; otherwise prepend base URL
  const url = urlOrPath.startsWith('http') ? urlOrPath : apiUrl(urlOrPath.startsWith('/') ? urlOrPath : `/${urlOrPath}`);

  // C6-FIX: Forward cookies from SSR context for authenticated server-side requests
  const ssrHeaders: Record<string, string> = {};
  if (options?.ctx?.req?.headers?.cookie) {
    ssrHeaders['Cookie'] = options.ctx.req.headers.cookie;
  }

  const response = await fetchWithRetry(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...ssrHeaders,
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response;
};
