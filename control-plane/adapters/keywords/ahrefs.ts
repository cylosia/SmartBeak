import fetch from 'node-fetch';

import { apiConfig } from '@config';
import { validateNonEmptyString } from '@kernel/validation';
import { withRetry } from '@kernel/retry';

import { KeywordIngestionAdapter, KeywordSuggestion } from './types';

import { BaseExternalAdapter } from '../base';


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

export class AhrefsAdapter extends BaseExternalAdapter implements KeywordIngestionAdapter {
  readonly source = 'ahrefs';
  private readonly apiToken: string;
  private readonly baseUrl: string;

  constructor(apiToken?: string) {
  super('AhrefsAdapter');
  this.apiToken = apiToken || process.env['AHREFS_API_TOKEN'] || '';

  if (!this.apiToken) {
    throw new Error('AHREFS_API_TOKEN is required');
  }

  this.baseUrl = apiConfig.baseUrls.ahrefs;
  }

  /**
  * Fetch keywords for a domain using Ahrefs API
  */
  async fetch(domain: string): Promise<KeywordSuggestion[]> {
  validateNonEmptyString(domain, 'domain');

  return this.instrumented('fetch', async (context) => {
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
        throw this.createRateLimitError('Ahrefs', response.status, response.headers);
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
    this.logger.warn('Skipping malformed keyword item in Ahrefs response', context);
    continue;
    }
    suggestions.push({
    keyword: item['keyword'],
    metrics: {
    volume: item['volume'],
    difficulty: typeof item['difficulty'] === 'number' ? item['difficulty'] : 0,
    cpc: typeof item['cpc'] === 'number' ? item['cpc'] : 0,
    ...(typeof item['position'] === 'number' ? { currentPosition: item['position'] } : {}),
    ...(typeof item['url'] === 'string' ? { rankingUrl: item['url'] } : {}),
    source: 'ahrefs',
    fetchedAt: new Date().toISOString(),
    },
    });
    }

    this.logger.info('Successfully fetched keywords from Ahrefs', context, {
    count: suggestions.length
    });

    return suggestions;
    } finally {
    clearTimeout(timeoutId);
    }
  }, { domain });
  }

  /**
  * Fetch keyword ideas for a seed keyword
  */
  async fetchKeywordIdeas(seedKeyword: string, country: string = 'us'): Promise<KeywordSuggestion[]> {
  validateNonEmptyString(seedKeyword, 'seedKeyword');
  validateNonEmptyString(country, 'country');

  return this.instrumented('fetchKeywordIdeas', async (context) => {
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
        throw this.createRateLimitError('Ahrefs', response.status, response.headers);
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
    this.logger.warn('Skipping malformed keyword idea in Ahrefs response', context);
    continue;
    }
    suggestions.push({
    keyword: item['keyword'],
    metrics: {
    volume: item['volume'],
    difficulty: typeof item['difficulty'] === 'number' ? item['difficulty'] : 0,
    cpc: typeof item['cpc'] === 'number' ? item['cpc'] : 0,
    ...(typeof item['parent_topic'] === 'string' ? { parentTopic: item['parent_topic'] } : {}),
    source: 'ahrefs',
    fetchedAt: new Date().toISOString(),
    },
    });
    }

    return suggestions;
    } finally {
    clearTimeout(timeoutId);
    }
  }, { seedKeyword, country });
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string | undefined }> {
  return this.healthProbe(async (signal) => {
    return await fetch(`${this.baseUrl}/v3/hello`, {
    method: 'GET',
    headers: {
    'Authorization': `Bearer ${this.apiToken}`,
    'Accept': 'application/json',
    },
    signal,
    });
  });
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
