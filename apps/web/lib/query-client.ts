import { QueryClient, QueryFunctionContext } from '@tanstack/react-query';

/**
* React Query Client Configuration
* Provides centralized data fetching and caching
* 
* P1-HIGH SECURITY FIXES:
* - Issue 17: Missing request timeout in hooks
* - Issue 18: Missing request cancellation on unmount
* - Issue 21: HTTPS enforcement
*/

// Default request timeout: 30 seconds
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

/**
 * Fetch with timeout and automatic cancellation support
 * SECURITY FIX: Issue 17 & 18 - Request timeout and cancellation
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  signal?: AbortSignal
): Promise<Response> {
  // SECURITY FIX: Issue 21 - HTTPS enforcement in production
  if (typeof window !== 'undefined' && process.env['NODE_ENV'] === 'production') {
    const urlObj = new URL(url, window.location.origin);
    if (urlObj.protocol !== 'https:' && urlObj.hostname !== 'localhost') {
      throw new Error('HTTPS required in production');
    }
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_REQUEST_TIMEOUT_MS);
  
  // Combine external signal with internal timeout.
  // SECURITY FIX P1-7: Use { once: true } to prevent event listener memory leak.
  // P1-8 FIX: If the caller passes an already-aborted signal (e.g. a query key
  // changed before the previous fetch even started), the 'abort' event has
  // already fired and addEventListener will never receive it — the request
  // would proceed despite the component having unmounted. Check signal.aborted
  // first and abort the internal controller immediately in that case.
  if (signal) {
    if (signal.aborted) {
      controller.abort();
    } else {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return response;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`);
    }
    throw error;
  }
}

/**
 * Default query function with timeout and error handling
 */
const defaultQueryFn = async ({ queryKey, signal }: QueryFunctionContext) => {
  // P1-2 FIX: Replace unsafe `as` cast with runtime validation. The previous cast
  // silently retyped whatever was in queryKey[1]; if a caller passed null or a
  // primitive, Object.entries() would throw a TypeError at runtime and crash the
  // component tree. We now validate the shape explicitly.
  const [rawUrl, rawParams] = queryKey;
  if (typeof rawUrl !== 'string') {
    throw new Error(`queryKey[0] must be a string URL, got: ${typeof rawUrl}`);
  }
  const url = rawUrl;
  const params =
    rawParams !== null &&
    rawParams !== undefined &&
    typeof rawParams === 'object' &&
    !Array.isArray(rawParams)
      ? (rawParams as Record<string, unknown>)
      : undefined;

  // P3-1 FIX: String(null) → "null" and String(undefined) → "undefined", which
  // are semantically incorrect query-string values. Filter out null/undefined
  // entries before encoding so they are simply omitted from the URL.
  // P3-2 FIX: Non-primitive values (objects, arrays, functions) produce
  // "[object Object]" or similar when coerced with String() — silently sending
  // meaningless query parameters that the server will reject or ignore.
  // Only allow string, number, and boolean values through.
  const queryString = params
    ? (() => {
        const entries = Object.entries(params)
          .filter(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
          .map(([k, v]) => [k, String(v)] as [string, string]);
        return entries.length > 0 ? '?' + new URLSearchParams(entries).toString() : '';
      })()
    : '';
  
  const response = await fetchWithTimeout(`${url}${queryString}`, {
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
    },
  }, signal);
  
  if (!response.ok) {
    // P2-15 FIX: response.json() returns any. If the server returns null, a
    // plain string, or an array, accessing `.message` throws TypeError at runtime.
    // Validate the shape before accessing the property.
    const body: unknown = await response.json().catch(() => null);
    const message =
      body !== null &&
      typeof body === 'object' &&
      'message' in body &&
      typeof (body as Record<string, unknown>)['message'] === 'string'
        ? (body as Record<string, unknown>)['message'] as string
        : `HTTP ${response.status}`;
    throw new Error(message);
  }
  
  return response.json();
};

/**
* Create a new QueryClient instance
* Can be called on both client and server
*/
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Default stale time: 5 minutes
        staleTime: 5 * 60 * 1000,
        // Default cache time: 10 minutes
        gcTime: 10 * 60 * 1000,
        // Retry failed requests 2 times
        retry: 2,
        // Refetch on window focus (disable for better UX)
        refetchOnWindowFocus: false,
        // Refetch on reconnect
        refetchOnReconnect: true,
        // SECURITY FIX: Issue 18 - Ensure queries can be cancelled
        queryFn: defaultQueryFn,
        // SECURITY FIX: Issue 17 - Network mode
        networkMode: 'online',
      },
      mutations: {
        // Retry mutations once on failure
        retry: 1,
        // SECURITY FIX: Issue 18 - Ensure mutations can be cancelled
        networkMode: 'online',
      },
    },
  });
}

/**
* Singleton query client for client-side usage
*/
let clientQueryClient: QueryClient | undefined;

export function getQueryClient() {
  if (typeof window === 'undefined') {
    // Server: always create a new instance
    return createQueryClient();
  }
  // Client: reuse existing instance
  if (!clientQueryClient) {
    clientQueryClient = createQueryClient();
  }
  return clientQueryClient;
}

/**
 * Prefetch data on server
 * Useful for SSR
 */
export async function prefetchQuery(
  queryClient: QueryClient,
  queryKey: string[],
  fetcher: () => Promise<unknown>
): Promise<void> {
  await queryClient.prefetchQuery({
    queryKey,
    queryFn: fetcher,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Invalidate multiple queries at once
 */
export function invalidateQueries(
  queryClient: QueryClient,
  queryKeys: string[][]
): Promise<void> {
  const promises = queryKeys.map(key => 
    queryClient.invalidateQueries({ queryKey: key })
  );
  return Promise.all(promises).then(() => undefined);
}

// Re-export fetch utility
export { fetchWithTimeout, DEFAULT_REQUEST_TIMEOUT_MS };
