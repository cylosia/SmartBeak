import fetch from 'node-fetch';

import { apiConfig, timeoutConfig } from '@config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';
import { validateNonEmptyString } from '@kernel/validation';
import { withRetry } from '@kernel/retry';

import { KeywordIngestionAdapter, KeywordSuggestion } from './types';

import { AbortController } from 'abort-controller';


/**

* Ahrefs Keyword Research Adapter
* Uses Ahrefs API v3 to fetch keyword suggestions and metrics
*
*
* Required env: AHREFS_API_TOKEN
* API Docs: https://ahrefs.com/api/documentation
*/

export interface AhrefsKeywordMetrics {
  keyword: string;
  volume: number;
  difficulty: number;
  cpc: number;
  parent_topic?: string;
}

export class AhrefsAdapter implements KeywordIngestionAdapter {
  readonly source = 'ahrefs';
  private readonly apiToken: string;
  private readonly baseUrl: string;
  private readonly timeoutMs = timeoutConfig.long;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(apiToken?: string) {
  this.apiToken = apiToken || process.env['AHREFS_API_TOKEN'] || '';

  if (!this.apiToken) {
    throw new Error('AHREFS_API_TOKEN is required');
  }

  this.baseUrl = apiConfig.baseUrls.ahrefs;
  this.logger = new StructuredLogger('AhrefsAdapter');
  this.metrics = new MetricsCollector('AhrefsAdapter');
  }

  /**
  * Fetch keywords for a domain using Ahrefs API
  */
  async fetch(domain: string): Promise<KeywordSuggestion[]> {
  const context = createRequestContext('AhrefsAdapter', 'fetch');

  validateNonEmptyString(domain, 'domain');

  this.logger.info('Fetching keywords from Ahrefs', context, { domain });

  const startTime = Date.now();

  try {
    // Clean domain (remove protocol)
    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

    // Fetch organic keywords for the domain
    const url = new URL(`${this.baseUrl}/site-explorer/organic-keywords`);
    url.searchParams.append('target', cleanDomain);
    url.searchParams.append('limit', '100');
    url.searchParams.append('where', 'volume>10');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
    const res = await withRetry(async () => {
    const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Accept': 'application/json',
    },
    signal: controller.signal,
    });

    if (!response.ok) {
    if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const error = new Error(`Ahrefs rate limited: ${response.status}`);
        (error as Error & { status: number; retryAfter?: string }).status = response.status;
        (error as Error & { status: number; retryAfter?: string | undefined }).retryAfter = retryAfter || undefined;
        throw error;
    }

    throw new Error(`Ahrefs API error: ${response.status} ${response.statusText}`);
    }

    return response;
    }, { maxRetries: 3 });

    const rawData: unknown = await res.json();

    if (typeof rawData !== 'object' || rawData === null) {
    return [];
    }
    const data = rawData as Record<string, unknown>;

    if (!data['keywords'] || !Array.isArray(data['keywords'])) {
    return [];
    }

    const suggestions: KeywordSuggestion[] = [];
    for (const kw of data['keywords']) {
    if (typeof kw !== 'object' || kw === null) continue;
    const item = kw as Record<string, unknown>;
    if (typeof item['keyword'] !== 'string' || typeof item['volume'] !== 'number') {
    this.logger.warn('Skipping malformed keyword item in Ahrefs response');
    continue;
    }
    suggestions.push({
    keyword: item['keyword'],
    metrics: {
    volume: item['volume'],
    difficulty: typeof item['difficulty'] === 'number' ? item['difficulty'] : 0,
    cpc: typeof item['cpc'] === 'number' ? item['cpc'] : 0,
    currentPosition: typeof item['position'] === 'number' ? item['position'] : undefined,
    rankingUrl: typeof item['url'] === 'string' ? item['url'] : undefined,
    source: 'ahrefs',
    fetchedAt: new Date().toISOString(),
    },
    });
    }

    const latency = Date.now() - startTime;
    this.metrics.recordLatency('fetch', latency, true);
    this.metrics.recordSuccess('fetch');
    this.logger.info('Successfully fetched keywords from Ahrefs', context, {
    count: suggestions.length
    });

    return suggestions;
    } finally {
    clearTimeout(timeoutId);
    }
  } catch (error) {
    const latency = Date.now() - startTime;
    this.metrics.recordLatency('fetch', latency, false);
    this.metrics.recordError('fetch', error instanceof Error ? error.name : 'Unknown');
    this.logger["error"]('Failed to fetch keywords from Ahrefs', context, error as Error);
    throw error;
  }
  }

  /**
  * Fetch keyword ideas for a seed keyword
  */
  async fetchKeywordIdeas(seedKeyword: string, country: string = 'us'): Promise<KeywordSuggestion[]> {
  const context = createRequestContext('AhrefsAdapter', 'fetchKeywordIdeas');

  validateNonEmptyString(seedKeyword, 'seedKeyword');
  validateNonEmptyString(country, 'country');

  const _startTime = Date.now();

  try {
    const url = new URL(`${this.baseUrl}/keywords-explorer/ideas`);
    url.searchParams.append('keyword', seedKeyword);
    url.searchParams.append('country', country);
    url.searchParams.append('limit', '50');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
    const res = await withRetry(async () => {
    const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
        'Authorization': `Bearer ${this.apiToken}`,
        'Accept': 'application/json',
    },
    signal: controller.signal,
    });

    if (!response.ok) {
    if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const error = new Error(`Ahrefs rate limited: ${response.status}`);
        (error as Error & { status: number; retryAfter?: string }).status = response.status;
        (error as Error & { status: number; retryAfter?: string | undefined }).retryAfter = retryAfter || undefined;
        throw error;
    }

    throw new Error(`Ahrefs API error: ${response.status}`);
    }

    return response;
    }, { maxRetries: 3 });

    const rawData: unknown = await res.json();

    if (typeof rawData !== 'object' || rawData === null) {
    return [];
    }
    const data = rawData as Record<string, unknown>;

    if (!data['ideas'] || !Array.isArray(data['ideas'])) {
    return [];
    }

    const suggestions: KeywordSuggestion[] = [];
    for (const kw of data['ideas']) {
    if (typeof kw !== 'object' || kw === null) continue;
    const item = kw as Record<string, unknown>;
    if (typeof item['keyword'] !== 'string' || typeof item['volume'] !== 'number') {
    this.logger.warn('Skipping malformed keyword idea in Ahrefs response');
    continue;
    }
    suggestions.push({
    keyword: item['keyword'],
    metrics: {
    volume: item['volume'],
    difficulty: typeof item['difficulty'] === 'number' ? item['difficulty'] : 0,
    cpc: typeof item['cpc'] === 'number' ? item['cpc'] : 0,
    parentTopic: typeof item['parent_topic'] === 'string' ? item['parent_topic'] : undefined,
    source: 'ahrefs',
    fetchedAt: new Date().toISOString(),
    },
    });
    }

    this.metrics.recordSuccess('fetchKeywordIdeas');
    return suggestions;
    } finally {
    clearTimeout(timeoutId);
    }
  } catch (error) {
    this.metrics.recordError('fetchKeywordIdeas', error instanceof Error ? error.name : 'Unknown');
    this.logger["error"]('Failed to fetch keyword ideas from Ahrefs', context, error as Error);
    throw error;
  }
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutConfig.short);

  try {
    // Use the API root or a lightweight endpoint for health check
    const res = await fetch(`${this.baseUrl}/v3/hello`, {
    method: 'GET',
    headers: {
    'Authorization': `Bearer ${this.apiToken}`,
    'Accept': 'application/json',
    },
    signal: controller.signal,
    });

    const latency = Date.now() - start;

    // Only 200-299 status codes indicate a healthy service
    const healthy = res.ok;

    return {
    healthy,
    latency,
    error: healthy ? undefined : `Ahrefs API returned status ${res.status}`,
    } as { healthy: boolean; latency: number; error?: string } | { healthy: boolean; latency: number; error: string };
  } catch (error) {
    return {
    healthy: false,
    latency: Date.now() - start,
    error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    clearTimeout(timeoutId);
  }
  }
}

// P1-FIX: Lazy initialization — previously crashed at module load if AHREFS_API_TOKEN was unset
let _ahrefsAdapter: AhrefsAdapter | null = null;
export function getAhrefsAdapter(): AhrefsAdapter {
  if (!_ahrefsAdapter) {
    _ahrefsAdapter = new AhrefsAdapter();
  }
  return _ahrefsAdapter;
}
// Backward-compatible alias (lazy)
export const ahrefsAdapter = { get instance() { return getAhrefsAdapter(); } };
