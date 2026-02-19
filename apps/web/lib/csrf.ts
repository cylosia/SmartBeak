/**
 * CSRF Token Utilities
 *
 * P1-FIX: Frontend pages making POST requests were missing the X-CSRF-Token header,
 * causing CSRF middleware to reject all state-changing requests (or leaving endpoints
 * unprotected if middleware was not active).
 *
 * The server uses a double-submit cookie pattern:
 * - Server sets a non-HttpOnly `csrf_token` cookie
 * - Client reads the cookie and sends it as the `x-csrf-token` header
 */

/**
 * Read the CSRF token from the cookie set by the server.
 * Returns undefined if the cookie is not present.
 */
export function getCsrfToken(): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const match = document.cookie.match(/(?:^|;\s*)csrf_token=([^;]*)/);
  return match?.[1] != null ? decodeURIComponent(match[1]) : undefined;
}

/**
 * Wrapper around fetch that automatically includes the CSRF token header
 * on state-changing requests (POST, PUT, PATCH, DELETE).
 */
export async function fetchWithCsrf(
  url: string,
  options: RequestInit = {}
): Promise<Response> {
  const method = (options.method ?? 'GET').toUpperCase();
  const needsCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method);

  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> ?? {}),
  };

  if (needsCsrf) {
    const token = getCsrfToken();
    if (token) {
      headers['x-csrf-token'] = token;
    }
  }

  return fetch(url, {
    ...options,
    headers,
    credentials: options.credentials ?? 'include',
  });
}

export default { getCsrfToken, fetchWithCsrf };
