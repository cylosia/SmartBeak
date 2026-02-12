import fetch from 'node-fetch';
import { AbortController } from 'abort-controller';

import { validateUrl } from '../../packages/security/ssrf';

/**
* Link check result type
*/
export type LinkStatus = 'active' | 'redirected' | 'broken' | 'timeout' | 'error';

/**
* Link check options
*/
export interface LinkCheckOptions {
  timeoutMs?: number;
  followRedirects?: boolean;
  userAgent?: string;
  method?: 'HEAD' | 'GET';
  retryWithGet?: boolean;
}

const DEFAULT_OPTIONS: LinkCheckOptions = {
  timeoutMs: 10000, // 10 second default timeout
  followRedirects: false,
  userAgent: 'SmartBeak-LinkChecker/1.0',
  method: 'HEAD',
  retryWithGet: true,
};

/**
* Checks link status (HEAD/GET) with timeout support
*
* @param url - URL to check
* @param options - Check options
* @returns Link status
*/
export async function checkLink(
  url: string,
  options: LinkCheckOptions = {}
): Promise<LinkStatus> {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  // Validate URL format
  try {
  new URL(url);
  } catch {
  return 'error';
  }

  // P0-FIX: SSRF protection — block requests to internal/private networks
  const ssrfCheck = validateUrl(url);
  if (!ssrfCheck.allowed) {
  return 'error';
  }

  const result = await checkWithMethod(url, opts.method || 'HEAD', opts);

  if (result === 'error' && opts.retryWithGet && opts.method === 'HEAD') {
  return checkWithMethod(url, 'GET', { ...opts, retryWithGet: false });
  }

  return result;
}

/**
* Check URL with specific HTTP method
*/
async function checkWithMethod(
  url: string,
  method: 'HEAD' | 'GET',
  opts: LinkCheckOptions
): Promise<LinkStatus> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
  const res = await fetch(url, {
    redirect: opts.followRedirects ? 'follow' : 'manual',
    signal: controller.signal,
    headers: {
    'User-Agent': opts.userAgent || DEFAULT_OPTIONS.userAgent || 'SmartBeak-LinkChecker/1.0',
    },
  });

  if (res.status === 405 && method === 'HEAD') {
    // Method Not Allowed - signal to retry with GET
    return 'error';
  }

  if (res.status >= 300 && res.status < 400) return 'redirected';
  if (res.status >= 400) return 'broken';
  if (res.status >= 200 && res.status < 300) return 'active';

  return 'error';
  } catch (error: unknown) {
  if (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError') {
    return 'timeout';
  }

  return 'error';
  } finally {
  // P2-FIX: clearTimeout in finally to prevent timer leaks
  clearTimeout(timeoutId);
  }
}

/**
* Check multiple links in parallel with concurrency limit
*/
export async function checkLinks(
  urls: string[],
  options: LinkCheckOptions = {},
  concurrency = 5
): Promise<Map<string, LinkStatus>> {
  const results = new Map<string, LinkStatus>();

  // P2-FIX: Deduplicate URLs before processing
  const uniqueUrls = [...new Set(urls)];

  // Process in batches to limit concurrency
  for (let i = 0; i < uniqueUrls.length; i += concurrency) {
  const batch = uniqueUrls.slice(i, i + concurrency);
  const batchResults = await Promise.all(
    batch.map(async (url) => ({
    url,
    status: await checkLink(url, options),
    }))
  );

  batchResults.forEach(({ url, status }) => {
    results.set(url, status);
  });
  }

  return results;
}

/**
* Check if a link is healthy (active or redirected)
*/
export async function isLinkHealthy(url: string, options?: LinkCheckOptions): Promise<boolean> {
  const status = await checkLink(url, options);
  return status === 'active' || status === 'redirected';
}
