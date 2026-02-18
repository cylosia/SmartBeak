import { timeoutConfig } from '@config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';
import { validateNonEmptyString } from '@kernel/validation';

import { KeywordIngestionAdapter, KeywordSuggestion } from './types';

import { google, searchconsole_v1, Auth } from 'googleapis';


/**

* Google Search Console Keyword Adapter
* Fetches search analytics data including keywords, impressions, clicks
*
*
* Required: GSC OAuth credentials + site verification
*/

export interface GSCCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken?: string | undefined;
}

/**
 * Validates OAuth state parameter: minimum 32 alphanumeric characters required for
 * sufficient CSRF entropy. Matches the requirement enforced in gbp.ts and linkedin.ts.
 */
function validateState(state: string): boolean {
  if (!state || state.length < 32) {
    return false;
  }
  return /^[a-zA-Z0-9_-]+$/.test(state);
}

export class GscAdapter implements KeywordIngestionAdapter {
  readonly source = 'gsc';
  private auth: Auth.OAuth2Client;
  private searchConsole: searchconsole_v1.Searchconsole;
  private readonly timeoutMs = timeoutConfig.long;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(credentials?: GSCCredentials) {
  // P1-1 FIX: use ?? not || so an explicitly-passed '' doesn't silently fall
  // through to the env var and use a different credential than the caller intended.
  const clientId = credentials?.clientId ?? process.env['GSC_CLIENT_ID'] ?? '';
  const clientSecret = credentials?.clientSecret ?? process.env['GSC_CLIENT_SECRET'] ?? '';

  if (!clientId || !clientSecret) {
    throw new Error('GSC_CLIENT_ID and GSC_CLIENT_SECRET are required');
  }

  this.auth = new google.auth.OAuth2(
    clientId,
    clientSecret,
    credentials?.redirectUri ?? process.env['GSC_REDIRECT_URI'] ?? ''
  );

  if (credentials?.refreshToken) {
    this.auth.setCredentials({ refresh_token: credentials.refreshToken });
  }

  this.searchConsole = google.searchconsole({ version: 'v1', auth: this.auth });
  this.logger = new StructuredLogger('GscAdapter');
  this.metrics = new MetricsCollector('GscAdapter');
  }

  /**
  * Generate OAuth URL for GSC authorization.
  * state is required and must be at least 32 alphanumeric characters for CSRF protection.
  */
  getAuthUrl(state: string): string {
  // P1-7 SEC FIX: Validate state to enforce minimum-entropy requirement consistent
  // with gbp.ts and linkedin.ts. Previously state was optional and unvalidated,
  // allowing callers to omit it entirely or pass a trivially guessable value.
  if (!validateState(state)) {
    throw new Error('state must be at least 32 alphanumeric characters (required for CSRF protection)');
  }
  return this.auth.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/webmasters.readonly'],
    prompt: 'consent',
    state,
  });
  }

  /**
  * Exchange code for tokens
  */
  async exchangeCode(code: string): Promise<{
  access_token: string;
  refresh_token?: string | undefined;
  expiry_date: number;
  }> {
  validateNonEmptyString(code, 'code');

  const { tokens } = await this.auth.getToken(code);
  if (!tokens.access_token || tokens.expiry_date == null) {
    throw new Error('Invalid token response from Google: missing access_token or expiry_date');
  }
  // P1-2 FIX: apply credentials to this.auth so subsequent API calls on this instance
  // are authenticated. Without this, callers who call exchangeCode() and then fetch()
  // on the same adapter instance receive authentication errors.
  this.auth.setCredentials(tokens);
  return {
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token ?? undefined,
    expiry_date: tokens.expiry_date,
  };
  }

  /**
  * Set refresh token for API calls
  */
  setRefreshToken(refreshToken: string): void {
  // P2-15 FIX: validate before setting — empty string would silently clear credentials
  validateNonEmptyString(refreshToken, 'refreshToken');
  this.auth.setCredentials({ refresh_token: refreshToken });
  }

  /**
  * Fetch keywords from GSC search analytics
  */
  async fetch(domain: string, days: number = 90): Promise<KeywordSuggestion[]> {
  const context = createRequestContext('GscAdapter', 'fetch');

  validateNonEmptyString(domain, 'domain');

  const startTime = Date.now();

  try {
    // Ensure proper site URL format
    let siteUrl = domain;
    if (!siteUrl.startsWith('http')) {
    siteUrl = `https://${siteUrl}`;
    }
    if (!siteUrl.endsWith('/')) {
    siteUrl = `${siteUrl}/`;
    }

    // P1-4 FIX: log the normalised siteUrl, not the raw domain — the raw domain
    // could contain embedded credentials (e.g. https://user:pass@internal.corp/)
    // which must not appear in log aggregation.
    this.logger.info('Fetching keywords from GSC', context, { siteUrl, days });

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // P2-1 FIX: use .slice(0, 10) — toISOString() always returns 'YYYY-MM-DDTHH:mm:ss.sssZ'
    // so slice is safe and avoids suppressing noUncheckedIndexedAccess with an 'as string' cast.
    // Capture in typed string variables so dateRange below can reference them without re-casting
    // through the googleapis Schema type (which widens them to string | null | undefined).
    const startDateStr = startDate.toISOString().slice(0, 10);
    const endDateStr = endDate.toISOString().slice(0, 10);

    const requestBody: searchconsole_v1.Schema$SearchAnalyticsQueryRequest = {
    startDate: startDateStr,
    endDate: endDateStr,
    dimensions: ['query'],
    rowLimit: 1000,
    aggregationType: 'auto',
    };

    // P1-2 SEC FIX: Use AbortController so that when the manual timeout fires, the
    // underlying HTTP connection to Google is actually cancelled. Without abort,
    // Promise.race() resolves the race client-side but the inflight HTTP request
    // continues holding a socket indefinitely. Under sustained load this exhausts all
    // available file descriptors and causes a cascading service outage.
    const controller = new AbortController();
    const fetchPromise = this.searchConsole.searchanalytics.query(
      { siteUrl, requestBody },
      { signal: controller.signal }
    );

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error('GSC request timeout'));
    }, this.timeoutMs);
    });

    let response: Awaited<typeof fetchPromise>;
    try {
    response = await Promise.race([fetchPromise, timeoutPromise]);
    } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    }
    const rows = response.data.rows ?? [];

    const suggestions = rows
    .map((row): KeywordSuggestion => {
    // P1-6 FIX: use ?? not || for the keyword so we can filter empty strings below.
    const query = row.keys?.[0] ?? '';
    return {
      keyword: query,
      metrics: {
      // P1-5 FIX: use ?? not || for numeric metrics. || treats 0 the same as
      // null/undefined; ?? correctly distinguishes them.
      clicks: row.clicks ?? 0,
      impressions: row.impressions ?? 0,
      ctr: row.ctr ?? 0,
      position: row.position ?? 0,
      source: 'gsc',
      fetchedAt: new Date().toISOString(),
      // P2-2 FIX: reference the typed string variables captured above rather
      // than re-indexing requestBody with an 'as string' cast that bypasses
      // the type-checker's narrowing (Schema fields are string | null | undefined).
      dateRange: {
        start: startDateStr,
        end: endDateStr,
      },
      },
    };
    })
    // P1-6 FIX: filter out empty-string keywords (rows with no keys array or
    // empty first element) — they pollute DB tables and corrupt cardinality counts.
    .filter(s => s.keyword !== '');

    const latency = Date.now() - startTime;
    this.metrics.recordLatency('fetch', latency, true);
    this.metrics.recordSuccess('fetch');
    this.logger.info('Successfully fetched keywords from GSC', context, {
    count: suggestions.length
    });

    return suggestions;
  } catch (error: unknown) {
    const latency = Date.now() - startTime;
    const errName = error instanceof Error ? error.name : 'Unknown';
    // P1-3 FIX: googleapis (gaxios) places HTTP status on error.response.status,
    // not on error.code. Comparing error.code === 401 was dead code — those branches
    // never triggered, letting raw Google errors (potentially with OAuth token
    // fragments in their message) propagate to callers unfiltered.
    const httpStatus =
    typeof error === 'object' && error !== null && 'response' in error
      ? (error as { response?: { status?: number } }).response?.status
      : undefined;
    // Fall back to error.code for network-level errors (ECONNRESET etc.)
    const errCode =
    httpStatus ??
    (typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code: unknown }).code
      : undefined);
    const errMessage = error instanceof Error ? error.message : String(error);
    this.metrics.recordLatency('fetch', latency, false);
    this.metrics.recordError('fetch', errName);
    this.logger.error('Failed to fetch keywords from GSC', context, error instanceof Error ? error : new Error(String(error)));

    // Provide more helpful error messages
    if (errCode === 401) {
    throw new Error('GSC authentication failed. Please re-authorize.');
    }
    if (errCode === 403) {
    throw new Error('Site not verified in Google Search Console or insufficient permissions.');
    }
    if (errMessage.includes('insufficientPermissions')) {
    throw new Error('Insufficient permissions. Ensure site is verified in GSC.');
    }

    throw error;
  }
  }

  /**
  * List sites verified in GSC
  */
  async listSites(): Promise<string[]> {
  const context = createRequestContext('GscAdapter', 'listSites');

  try {
    const response = await this.searchConsole.sites.list();
    // P2-3 FIX: flatMap with guard drops entries where siteUrl is null/undefined
    // instead of emitting empty-string URLs that break downstream consumers.
    const sites = response.data.siteEntry?.flatMap(entry => entry.siteUrl ? [entry.siteUrl] : []) ?? [];

    this.metrics.recordSuccess('listSites');
    return sites;
  } catch (error: unknown) {
    const errName = error instanceof Error ? error.name : 'Unknown';
    this.metrics.recordError('listSites', errName);
    this.logger.error('Failed to list GSC sites', context, error instanceof Error ? error : new Error(String(error)));
    throw error;
  }
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string }> {
  const start = Date.now();

  // P1-2 SEC FIX: Use AbortController so the underlying HTTP connection to Google is
  // cancelled when the health-check timeout fires. Previously Promise.race() rejected
  // but the inflight sites.list() request continued holding a socket indefinitely.
  const controller = new AbortController();
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      controller.abort();
      reject(new Error('Health check timeout'));
    }, timeoutConfig.short);
    });

    const checkPromise = this.searchConsole.sites.list({}, { signal: controller.signal });
    await Promise.race([checkPromise, timeoutPromise]);

    return {
    healthy: true,
    latency: Date.now() - start,
    };
  } catch (error: unknown) {
    const errMessage = error instanceof Error ? error.message : 'Unknown error';
    return {
    healthy: false,
    latency: Date.now() - start,
    error: errMessage,
    };
  } finally {
    if (timeoutId !== undefined) {
    clearTimeout(timeoutId);
    }
  }
  }
}

// Backward-compatible lazy-initialized singleton (avoids crash at import time if env vars are missing)
// NOTE: this singleton lives for the process lifetime. After secret rotation
// (GSC_CLIENT_ID / GSC_CLIENT_SECRET), the singleton continues using stale credentials
// until process restart. Call resetGscAdapter() immediately after rotating secrets,
// or prefer passing explicit credentials to new GscAdapter(credentials) directly.
let _gscAdapter: GscAdapter | undefined;

export function getGscAdapter(): GscAdapter {
  if (!_gscAdapter) {
    _gscAdapter = new GscAdapter();
  }
  return _gscAdapter;
}

/** Reset the singleton so the next getGscAdapter() call picks up rotated credentials. */
export function resetGscAdapter(): void {
  _gscAdapter = undefined;
}
