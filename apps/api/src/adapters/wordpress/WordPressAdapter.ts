import { getLogger } from '@kernel/logger';
import { MetricsCollector } from '@kernel/request';
import { withRetry } from '../../utils/retry';
// SECURITY FIX: Use DNS-validated URL check to prevent DNS rebinding SSRF attacks.
// validateUrl() only checks hostname strings against patterns but never resolves DNS.
// An attacker can register a domain that resolves to 127.0.0.1 or 169.254.169.254
// to bypass the string-based check. validateUrlWithDns() resolves DNS first.
import { validateUrlWithDns } from '@security/ssrf';

import { DEFAULT_TIMEOUTS } from '@config';

/**
* WordPress Adapter
* Handles WordPress API integration
*/

const logger = getLogger('WordPressAdapter');
const metrics = new MetricsCollector('WordPressAdapter');

// P2-RESPONSE-SIZE FIX: Cap inbound response bodies to prevent OOM from a
// hostile or misconfigured WordPress endpoint sending gigabyte payloads.
const MAX_RESPONSE_BYTES = 10 * 1024 * 1024; // 10 MB

// Define WordPress post type
export interface WordPressPost {
  id: number;
  title: { rendered: string };
  content: { rendered: string };
  excerpt?: { rendered: string };
  date: string;
  modified: string;
  status: string;
  author: number;
  featured_media?: number;
  categories?: number[];
  tags?: number[];
}

// Define adapter config type
export interface WordPressConfig {
  baseUrl: string;
  username?: string;
  password?: string;
  // apiVersion controls the WP REST API path segment (default: "v2").
  apiVersion?: string;
}

/**
 * Throw if the response Content-Length exceeds MAX_RESPONSE_BYTES.
 * HEAD responses legitimately have no body but may still include a Content-Length
 * that tells us how large a subsequent GET would be.
 */
function assertResponseSizeOk(response: Response): void {
  const contentLength = response.headers.get('content-length');
  if (contentLength !== null) {
    const bytes = parseInt(contentLength, 10);
    if (!Number.isNaN(bytes) && bytes > MAX_RESPONSE_BYTES) {
      throw new Error(
        `WordPress response too large: ${bytes} bytes exceeds limit of ${MAX_RESPONSE_BYTES} bytes`
      );
    }
  }
}

/**
* Fetch posts from WordPress
*/
export async function fetchWordPressPosts(
  config: WordPressConfig,
  options: { perPage?: number; page?: number } = {}
): Promise<WordPressPost[]> {
  const { perPage = 10, page = 1 } = options;

  // URL validation for baseUrl
  if (!config.baseUrl || typeof config.baseUrl !== 'string') {
  throw new Error('Invalid WordPress config: baseUrl is required');
  }

  // P0-1 SECURITY FIX: SSRF protection using centralized utility with DNS rebinding prevention
  const urlCheck = await validateUrlWithDns(config.baseUrl, { requireHttps: false, allowHttp: true });
  if (!urlCheck.allowed) {
  throw new Error(`SSRF protection: ${urlCheck.reason}`);
  }

  // P1-6 SECURITY FIX: Enforce HTTPS when credentials are present
  if (config.username && config.password && config.baseUrl.startsWith('http://')) {
  throw new Error('HTTPS is required when using authentication credentials');
  }

  // TOCTOU FIX: Fail closed — do not fall back to attacker-controlled config.baseUrl
  // if the SSRF library omits sanitizedUrl (e.g. a future API version change).
  if (!urlCheck.sanitizedUrl) {
    throw new Error('Internal: SSRF validation did not return a sanitized URL');
  }
  const baseUrl = urlCheck.sanitizedUrl;

  const rawApiVersion = config.apiVersion || 'v2';
  // P1-A FIX: Validate apiVersion to prevent path traversal (e.g. "../../wp-admin")
  if (!/^v\d+$/.test(rawApiVersion)) {
    throw new Error(`Invalid apiVersion: must match pattern v{number}, got: ${rawApiVersion}`);
  }
  const apiVersion = rawApiVersion;
  const url = new URL(`${baseUrl}/wp-json/wp/${apiVersion}/posts`);
  url.searchParams.set('per_page', String(perPage));
  url.searchParams.set('page', String(page));

  const headers: Record<string, string> = {
  'Accept': 'application/json',
  };

  if (config.username && config.password) {
  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  headers['Authorization'] = `Basic ${auth}`;
  }

  // P1-4 FIX: AbortController moved to be created fresh per retry attempt
  const startTime = Date.now();
  try {
  const response = await withRetry(() => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS['medium']);
    return fetch(url.toString(), { headers, signal: controller.signal })
    .finally(() => clearTimeout(timeoutId));
  }, { maxRetries: 3 });

  if (!response.ok) {
    throw new Error(`WordPress API error: ${response.status} ${response.statusText}`);
  }

  // P2-RESPONSE-SIZE FIX: Reject oversized responses before buffering the body.
  assertResponseSizeOk(response);

  // P1-B FIX: Read body as text first to enforce size limit even when
  // Content-Length is absent (e.g. chunked transfer encoding from hostile server).
  const responseText = await response.text();
  if (Buffer.byteLength(responseText, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error(`WordPress response body too large: exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  const rawData: unknown = JSON.parse(responseText);
  if (!Array.isArray(rawData)) {
    throw new Error('Invalid response format: expected array');
  }
  const posts = rawData as WordPressPost[];
  return posts;
  } catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error('WordPress API error', err, { context: 'WordPressAdapter.fetchPosts', status: (error as { status?: number })['status'] });
  metrics.recordError('fetchPosts', err.name);
  throw new Error('Failed to fetch WordPress posts');
  } finally {
  const duration = Date.now() - startTime;
  metrics.recordLatency('fetchPosts', duration, true);
  }
}

/**
* Create WordPress post
*/
export async function createWordPressPost(
  config: WordPressConfig,
  post: {
  title: string;
  content: string;
  status?: 'draft' | 'publish' | 'pending' | 'private';
  categories?: number[];
  tags?: number[];
  }
): Promise<WordPressPost> {
  // URL validation for baseUrl
  if (!config.baseUrl || typeof config.baseUrl !== 'string') {
  throw new Error('Invalid WordPress config: baseUrl is required');
  }

  // P0-1 SECURITY FIX: SSRF protection using centralized utility with DNS rebinding prevention
  const urlCheck = await validateUrlWithDns(config.baseUrl, { requireHttps: false, allowHttp: true });
  if (!urlCheck.allowed) {
  throw new Error(`SSRF protection: ${urlCheck.reason}`);
  }

  // P1-6 SECURITY FIX: Enforce HTTPS when credentials are present
  if (config.username && config.password && config.baseUrl.startsWith('http://')) {
  throw new Error('HTTPS is required when using authentication credentials');
  }

  // TOCTOU FIX: Fail closed — do not fall back to attacker-controlled config.baseUrl.
  if (!urlCheck.sanitizedUrl) {
    throw new Error('Internal: SSRF validation did not return a sanitized URL');
  }
  const baseUrl = urlCheck.sanitizedUrl;

  const rawApiVersion = config.apiVersion || 'v2';
  // P1-A FIX: Validate apiVersion to prevent path traversal (e.g. "../../wp-admin")
  if (!/^v\d+$/.test(rawApiVersion)) {
    throw new Error(`Invalid apiVersion: must match pattern v{number}, got: ${rawApiVersion}`);
  }
  const apiVersion = rawApiVersion;
  const url = `${baseUrl}/wp-json/wp/${apiVersion}/posts`;

  const headers: Record<string, string> = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  };

  if (config.username && config.password) {
  const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  headers['Authorization'] = `Basic ${auth}`;
  }

  const startTime = Date.now();
  try {
  // P0-IDEMPOTENCY FIX: Do NOT use withRetry for this POST request.
  // WordPress POST /posts is NOT idempotent — each retry would create an
  // additional duplicate post if the first attempt reached the server but the
  // response was lost (network timeout, proxy reset, etc.).  Retrying would
  // produce N posts for a single logical create operation (silent data duplication).
  // Use a single attempt with a per-request AbortController for timeout only.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS['medium']);
  // P0-2 FIX: Pass headers to fetch (was missing entirely)
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      title: post.title,
      content: post.content,
      status: post.status || 'draft',
      categories: post.categories || [],
      tags: post.tags || [],
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId));

  if (!response.ok) {
    throw new Error(`WordPress API error: ${response.status} ${response.statusText}`);
  }

  // P2-RESPONSE-SIZE FIX: Reject oversized responses before buffering the body.
  assertResponseSizeOk(response);

  // P1-B FIX: Read body as text first to enforce size limit even when
  // Content-Length is absent (e.g. chunked transfer encoding from hostile server).
  const responseText = await response.text();
  if (Buffer.byteLength(responseText, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new Error(`WordPress response body too large: exceeds ${MAX_RESPONSE_BYTES} bytes`);
  }
  const rawData: unknown = JSON.parse(responseText);
  if (!rawData || typeof rawData !== 'object' || Array.isArray(rawData)) {
    throw new Error('Invalid response format: expected object');
  }
  const created = rawData as WordPressPost;
  return created;
  } catch (error) {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error('WordPress API error', err, { context: 'WordPressAdapter.createPost', status: (error as { status?: number })['status'] });
  metrics.recordError('createPost', err.name);
  throw new Error('Failed to create WordPress post');
  } finally {
  const duration = Date.now() - startTime;
  metrics.recordLatency('createPost', duration, true);
  }
}

/**
* Health check for WordPress API
* @param config - WordPress configuration
* @returns Health check result
*/
export async function healthCheck(config: WordPressConfig): Promise<{ healthy: boolean; latency: number; error?: string | undefined }> {
  const start = Date.now();

  // URL validation for baseUrl
  if (!config.baseUrl || typeof config.baseUrl !== 'string') {
  return {
    healthy: false,
    latency: 0,
    error: 'Invalid WordPress config: baseUrl is required',
  };
  }

  // P0-1 SECURITY FIX: SSRF protection using centralized utility with DNS rebinding prevention
  const urlCheck = await validateUrlWithDns(config.baseUrl, { requireHttps: false, allowHttp: true });
  if (!urlCheck.allowed) {
  return {
    healthy: false,
    latency: 0,
    error: `SSRF protection: ${urlCheck.reason}`,
  };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
  // TOCTOU FIX: Fail closed — do not fall back to attacker-controlled config.baseUrl.
  if (!urlCheck.sanitizedUrl) {
    return { healthy: false, latency: 0, error: 'Internal: SSRF validation did not return a sanitized URL' };
  }
  const baseUrl = urlCheck.sanitizedUrl;

  const rawApiVersion = config.apiVersion || 'v2';
  // P1-A FIX: Validate apiVersion to prevent path traversal (e.g. "../../wp-admin")
  if (!/^v\d+$/.test(rawApiVersion)) {
    return { healthy: false, latency: 0, error: `Invalid apiVersion: must match pattern v{number}, got: ${rawApiVersion}` };
  }
  const apiVersion = rawApiVersion;
  const url = `${baseUrl}/wp-json/wp/${apiVersion}/posts?per_page=1`;
  const headers: Record<string, string> = {
    'Accept': 'application/json',
  };

  // Add auth if credentials provided
  if (config.username && config.password) {
    const auth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    headers['Authorization'] = `Basic ${auth}`;
  }

  // P1-5 FIX: Pass headers to fetch (was missing)
  const response = await fetch(url, {
    headers,
    signal: controller.signal,
    method: 'HEAD'
  });

  // P2-LATENCY FIX: Capture latency at response receipt (not after subsequent ops)
  // and reuse the value in the return object instead of recomputing it.
  const latency = Date.now() - start;

  // Only 200-299 status codes indicate a healthy service
  const healthy = response.ok;

  return {
    healthy,
    latency,
    error: healthy ? undefined : `WordPress API returned status ${response.status}`,
  };
  } catch (error) {
  return {
    healthy: false,
    latency: Date.now() - start,
    error: error instanceof Error ? error['message'] : 'Unknown error',
  };
  } finally {
  clearTimeout(timeoutId);
  }
}

/**
* Parse WordPress content
*/
// P2-2 FIX: Cap input size before applying any regex to prevent ReDoS.
// The image regex `[^>]+src=` can catastrophically backtrack on malformed HTML
// (e.g. a long string with no closing `>`) even with the iteration guard,
// because the guard limits the NUMBER of matches, not backtracking within one.
const MAX_PARSE_INPUT_BYTES = 2 * 1024 * 1024; // 2 MB

export function parseWordPressContent(htmlContent: string): { text: string; images: string[] } {
  if (!htmlContent || typeof htmlContent !== 'string') {
  return { text: '', images: [] };
  }

  // P2-2 FIX: Reject oversized inputs before regex application to bound backtracking time.
  if (Buffer.byteLength(htmlContent, 'utf8') > MAX_PARSE_INPUT_BYTES) {
    logger.warn('parseWordPressContent: input truncated to prevent ReDoS', {
      context: 'WordPressAdapter.parseWordPressContent',
      sizeBytes: Buffer.byteLength(htmlContent, 'utf8'),
    });
    return { text: '', images: [] };
  }

  // P1-FIX: ReDoS - Simplified regex without catastrophic backtracking
  // P2-9 FIX: Match both single and double quotes (was only matching single quotes)
  const imageRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
  const images: string[] = [];
  let match;
  let iterations = 0;
  const MAX_ITERATIONS = 1000;

  // Reset lastIndex to prevent issues with global regex
  imageRegex.lastIndex = 0;

  while ((match = imageRegex.exec(htmlContent)) !== null && iterations < MAX_ITERATIONS) {
  iterations++;
  images.push(match[1]!);
  }

  if (iterations >= MAX_ITERATIONS) {
  logger.warn('Regex iteration limit reached', { iterations, context: 'WordPressAdapter.parseWordPressContent' });
  }

  // Strip HTML tags for plain text
  const text = htmlContent
  .replace(/<[^>]+>/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

  return { text, images };
}
