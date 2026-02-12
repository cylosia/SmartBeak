import fetch from 'node-fetch';

import { apiConfig, timeoutConfig } from '@config';
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
    this.logger["error"]('Failed to fetch PAA questions', context, error as Error);
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
  private async fetchFromDataForSeo(_keyword: string): Promise<KeywordSuggestion[]> {
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
    const response = await fetch('https://api.dataforseo.com/v3/serp/google/organic/live/advanced', {
    method: 'POST',
    headers: {
    'Authorization': `Basic ${auth}`,
    'Content-Type': 'application/json',
    },
    body: JSON.stringify([{
    location_code: this.getLocationCode(this.country),
    language_code: this.language,
    depth: 100,
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
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT_MS);

  try {
    // Try a simple search as health check
    await Promise.race([
    this.fetchForKeyword('test'),
    new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => {
    reject(new Error('Health check timeout'));
    });
    })
    ]);

    clearTimeout(timeoutId);
    return {
    healthy: true,
    latency: Date.now() - start,
    };
  } catch (error) {
    clearTimeout(timeoutId);
    // If error is auth-related, service is reachable
    const errorMessage = error instanceof Error ? error.message : '';
    const isAuthError = errorMessage.includes('401') || errorMessage.includes('403');

    return {
    healthy: isAuthError,
    latency: Date.now() - start,
    error: isAuthError ? undefined : errorMessage,
    } as { healthy: boolean; latency: number; error?: string } | { healthy: boolean; latency: number; error: string };
  }
  }
}

// Backward-compatible default export
export const paaAdapter = new PaaAdapter();
