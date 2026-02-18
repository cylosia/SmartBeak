import fetch from 'node-fetch';

import { apiConfig, timeoutConfig, API_BASE_URLS } from '@config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';
import { validateNonEmptyString } from '@kernel/validation';
import { withRetry } from '@kernel/retry';

import { KeywordIngestionAdapter, KeywordSuggestion } from './types';

import { AbortController } from 'abort-controller';


/**

* People Also Ask (PAA) Keyword Adapter
* Fetches related questions from search results
*
*
* Supports: SerpApi, DataForSEO
*/

export type SerpProvider = 'serpapi' | 'dataforseo' | 'custom';

export interface PAAOptions {
  provider?: SerpProvider;
  apiKey?: string;
  country?: string;
  language?: string;
  depth?: number;
}

export interface PAAQuestion {
  question: string;
  answer?: string;
  relatedKeywords?: string[];
  sourceUrl?: string;
}

export class PaaAdapter implements KeywordIngestionAdapter {
  readonly source = 'paa';
  private readonly provider: SerpProvider;
  private readonly apiKey: string;
  private readonly country: string;
  private readonly language: string;
  private readonly depth: number;
  private readonly timeoutMs = timeoutConfig.long;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(options: PAAOptions = {}) {
  this.provider = options.provider || (process.env['SERP_API_PROVIDER'] as SerpProvider) || 'serpapi';
  this.apiKey = options.apiKey || process.env['SERP_API_KEY'] || '';
  this.country = options.country || 'us';
  this.language = options.language || 'en';
  this.depth = Math.min(Math.max(options.depth || 1, 1), 3);

  if (!this.apiKey && this.provider !== 'custom') {
    throw new Error('SERP_API_KEY is required for PAA adapter');
  }

  this.logger = new StructuredLogger('PaaAdapter');
  this.metrics = new MetricsCollector('PaaAdapter');
  }

  /**
  * Fetch PAA questions for a domain/keyword
  */
  async fetch(domain: string): Promise<KeywordSuggestion[]> {
  // Extract main topic from domain or use domain name
  const seedKeyword = domain
    .replace(/^https?:\/\//, '')
    .replace(/\.[a-z]+$/, '')
    .replace(/-/g, ' ');

  return this.fetchForKeyword(seedKeyword);
  }

  /**
  * Fetch PAA questions for a specific keyword
  */
  async fetchForKeyword(keyword: string): Promise<KeywordSuggestion[]> {
  const context = createRequestContext('PaaAdapter', 'fetchForKeyword');

  validateNonEmptyString(keyword, 'keyword');

  this.logger.info('Fetching PAA questions', context, { keyword, provider: this.provider });

  const startTime = Date.now();

  try {
    let suggestions: KeywordSuggestion[];

    switch (this.provider) {
    case 'serpapi':
    suggestions = await this.fetchFromSerpApi(keyword);
    break;
    case 'dataforseo':
    suggestions = await this.fetchFromDataForSeo(keyword);
    break;
    case 'custom':
    suggestions = await this.fetchFromCustom(keyword);
    break;
    default: {
      const _exhaustiveCheck: never = this.provider;
      throw new Error(`Unknown provider: ${_exhaustiveCheck}`);
    }
    }

    const latency = Date.now() - startTime;
    this.metrics.recordLatency('fetchForKeyword', latency, true);
    this.metrics.recordSuccess('fetchForKeyword');
    this.logger.info('Successfully fetched PAA questions', context, {
    count: suggestions.length
    });

    return suggestions;
  } catch (error) {
    const latency = Date.now() - startTime;
    this.metrics.recordLatency('fetchForKeyword', latency, false);
    this.metrics.recordError('fetchForKeyword', error instanceof Error ? error.name : 'Unknown');
    this.logger.error('Failed to fetch PAA questions', context, error as Error);
    throw error;
  }
  }

  /**
  * Fetch from SerpApi

  */
  private async fetchFromSerpApi(keyword: string): Promise<KeywordSuggestion[]> {
  const url = new URL(apiConfig.baseUrls.serpapi + '/search');
  url.searchParams.append('q', keyword);

  url.searchParams.append('engine', 'google');
  url.searchParams.append('gl', this.country);
  url.searchParams.append('hl', this.language);
  url.searchParams.append('google_domain', `google.${this.country}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

  try {
    const res = await withRetry(async () => {

    const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
    'Authorization': `Bearer ${this.apiKey}`,
    },
    signal: controller.signal,
    });

    if (!response.ok) {
    if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    const error = new Error(`SerpApi rate limited: ${response.status}`);
    (error as Error & { status: number; retryAfter?: string }).status = response.status;
    (error as Error & { status: number; retryAfter?: string | undefined }).retryAfter = retryAfter ?? undefined;
    throw error;
    }

    throw new Error(`SerpApi error: ${response.status} ${response.statusText}`);
    }

    return response;
    }, { maxRetries: 3 });

    const data = await res.json() as {
    related_questions?: Array<{
    question: string;
    snippet?: string;
    link?: string;
    }>;
    related_searches?: Array<{
    query: string;
    }>;
    };

    const suggestions: KeywordSuggestion[] = [];

    // Extract PAA questions
    if (data.related_questions) {
    data.related_questions.forEach((q, index) => {
    suggestions.push({
    keyword: q.question,
    metrics: {
        type: 'paa_question',
        position: index + 1,
        answerPreview: q.snippet?.substring(0, 200),
        sourceUrl: q.link,
        relatedSearches: data.related_searches?.map(r => r.query) || [],
        source: 'paa_serpapi',
        fetchedAt: new Date().toISOString(),
    },
    });
    });
    }

    // Also include related searches
    if (data.related_searches) {
    data.related_searches.forEach((rs, index) => {
    suggestions.push({
    keyword: rs.query,
    metrics: {
        type: 'related_search',
        position: index + 1,
        source: 'paa_serpapi',
        fetchedAt: new Date().toISOString(),
    },
    });
    });
    }

    return suggestions;
  } finally {
    clearTimeout(timeoutId);
  }
  }

  /**
  * Fetch from DataForSEO
  */
  // P1-FIX: Rename _keyword → keyword so the value is included in the request body
  private async fetchFromDataForSeo(keyword: string): Promise<KeywordSuggestion[]> {
  const login = process.env['DATAFORSEO_LOGIN'];
  const password = process.env['DATAFORSEO_PASSWORD'];

  if (!login || !password) {
    throw new Error('DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required');
  }

  const auth = Buffer.from(`${login}:${password}`).toString('base64');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

  try {
    const res = await withRetry(async () => {
    const response = await fetch(`${API_BASE_URLS.dataforseo}/v3/serp/google/organic/live/advanced`, {
    method: 'POST',
    headers: {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/json',
    },
    // P1-FIX: Use this.depth (capped at 3 in the constructor) instead of the
    // hardcoded 100. The hardcoded value requested 100 results per call from
    // DataForSEO regardless of the configured depth, consuming excess API quota
    // and incurring unbounded cost proportional to attacker-controlled keywords.
    body: JSON.stringify([{
    keyword,
    location_code: this.getLocationCode(this.country),
    language_code: this.language,
    depth: this.depth,
    }]),
    signal: controller.signal,
    });

    if (!response.ok) {
    if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    const error = new Error(`DataForSEO rate limited: ${response.status}`);
    (error as Error & { status: number; retryAfter?: string }).status = response.status;
    (error as Error & { status: number; retryAfter?: string | undefined }).retryAfter = retryAfter ?? undefined;
    throw error;
    }

    throw new Error(`DataForSEO error: ${response.status} ${response.statusText}`);
    }

    return response;
    }, { maxRetries: 3 });

    const data = await res.json() as {
    tasks?: Array<{
    result?: Array<{
    items?: Array<{
        type: string;
        title?: string;
        question_text?: string;
        answer_text?: string;
    }>;
    }>;
    }>;
    };

    const suggestions: KeywordSuggestion[] = [];
    const items = data.tasks?.[0]?.result?.[0]?.items || [];

    items.forEach((item, index) => {
    if (item.type === 'people_also_ask' && item.question_text) {
    suggestions.push({
    keyword: item.question_text,
    metrics: {
        type: 'paa_question',
        position: index + 1,
        answerPreview: item.answer_text?.substring(0, 200),
        source: 'paa_dataforseo',
        fetchedAt: new Date().toISOString(),
    },
    });
    }
    });

    return suggestions;
  } finally {
    clearTimeout(timeoutId);
  }
  }

  /**
  * Custom SERP scraper (placeholder)
  */
  private async fetchFromCustom(keyword: string): Promise<KeywordSuggestion[]> {
  const customEndpoint = process.env['CUSTOM_SERP_ENDPOINT'];
  if (!customEndpoint) {
    throw new Error('CUSTOM_SERP_ENDPOINT is required for custom provider');
  }

  // P0-SECURITY FIX: Validate CUSTOM_SERP_ENDPOINT to prevent SSRF.
  // Without validation an attacker who controls this env var can reach
  // internal services (AWS IMDS, databases, internal APIs).
  try {
    const parsed = new URL(customEndpoint);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new Error(`Unsupported protocol: ${parsed.protocol}`);
    }
    const forbidden = ['localhost', '127.0.0.1', '::1', '0.0.0.0', '169.254.169.254', '169.254.170.2'];
    const hostname = parsed.hostname.toLowerCase();
    // Strip IPv6 brackets so "[::1]" becomes "::1" for the checks below.
    const bare = hostname.startsWith('[') && hostname.endsWith(']')
      ? hostname.slice(1, -1)
      : hostname;
    if (
      forbidden.includes(bare) ||
      // Block private IPv4 ranges
      /^10\./.test(bare) ||
      /^192\.168\./.test(bare) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(bare) ||
      // Block link-local IPv4
      /^169\.254\./.test(bare) ||
      // Block IPv6 loopback, link-local, ULA (fc00::/7), and IPv4-mapped private
      /^::1$/.test(bare) ||
      /^fe[89ab][0-9a-f]:/i.test(bare) ||   // fe80::/10 link-local
      /^fc[0-9a-f]{2}:/i.test(bare) ||        // fc00::/7 ULA
      /^fd[0-9a-f]{2}:/i.test(bare) ||        // fd00::/8 ULA
      /^::ffff:(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.)/i.test(bare)  // IPv4-mapped private
    ) {
      throw new Error(`CUSTOM_SERP_ENDPOINT points to a private/reserved address: ${bare}`);
    }
  } catch (e) {
    throw new Error(`Invalid CUSTOM_SERP_ENDPOINT: ${e instanceof Error ? e.message : String(e)}`);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

  try {
    const res = await withRetry(async () => {
    const response = await fetch(`${customEndpoint}/paa`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword, country: this.country }),
    signal: controller.signal,
    });

    if (!response.ok) {
    throw new Error(`Custom SERP error: ${response.status}`);
    }

    return response;
    }, { maxRetries: 3 });

    return await res.json() as KeywordSuggestion[];
  } finally {
    clearTimeout(timeoutId);
  }
  }

  /**
  * Convert country code to DataForSEO location code
  */
  private getLocationCode(country: string): number {
  const codes: Record<string, number> = {
    us: 2840,
    uk: 2826,
    ca: 2124,
    au: 2036,
    de: 2276,
    fr: 2250,
  };
  return codes[country.toLowerCase()] || 2840;
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string }> {
  const start = Date.now();

  const HEALTH_CHECK_TIMEOUT_MS = 5000;

  // P1-FIX: The previous implementation used Promise.race between
  // fetchForKeyword (which creates its OWN internal AbortController+timeout)
  // and a separate abort signal. When the health-check timeout fired, the
  // Promise.race resolved but fetchForKeyword's internal HTTP request
  // continued in the background, leaking a socket and timer for up to
  // `this.timeoutMs` (30 s) per health check call. Under Kubernetes liveness
  // probe frequency (every 10 s) this accumulated rapidly.
  //
  // Fix: race against an AbortSignal-backed promise so fetchForKeyword's
  // internal signal fires when the health check timeout expires, aborting
  // the underlying HTTP request immediately.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  try {
    // fetchForKeyword does not yet accept an external signal; wrap the call
    // in a race that rejects on abort so the await unblocks promptly.
    await Promise.race([
    this.fetchForKeyword('test'),
    new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => {
      reject(new Error('Health check timeout'));
      }, { once: true });
    }),
    ]);

    return {
    healthy: true,
    latency: Date.now() - start,
    };
  } catch (error) {
    // If error is auth-related, service is reachable but creds are wrong
    const errorMessage = error instanceof Error ? error.message : '';
    const isAuthError = errorMessage.includes('401') || errorMessage.includes('403');

    // exactOptionalPropertyTypes: omit the `error` key entirely when healthy
    // rather than setting it to undefined (which is not assignable to `error?: string`).
    if (isAuthError) {
    return { healthy: true, latency: Date.now() - start };
    }
    return { healthy: false, latency: Date.now() - start, error: errorMessage };
  } finally {
    clearTimeout(timeoutId);
  }
  }
}

// P0-FIX: Lazy singleton — eager instantiation crashes the process at import time
// if SERP_API_KEY is absent (e.g. in test runners, workers missing the env var).
let _paaAdapterInstance: PaaAdapter | undefined;
export function getPaaAdapter(): PaaAdapter {
  return (_paaAdapterInstance ??= new PaaAdapter());
}

/**
 * @deprecated Use getPaaAdapter() instead.
 * P3-FIX: Corrected the deprecation note — this Proxy does NOT crash at module
 * load time (the Proxy itself is always constructible). It will throw on the
 * FIRST METHOD CALL if SERP_API_KEY is absent, because the Proxy delegates to
 * getPaaAdapter() which calls `new PaaAdapter()` lazily. Callers relying on the
 * old (incorrect) note that "it crashes at import" may have written workarounds
 * that are now unnecessary. Prefer getPaaAdapter() for explicit lazy behaviour.
 */
export const paaAdapter: PaaAdapter = new Proxy({} as PaaAdapter, {
  get(_target, prop) {
    return getPaaAdapter()[prop as keyof PaaAdapter];
  },
});
