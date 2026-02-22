import { validateNonEmptyString } from '@kernel/validation';

import { KeywordIngestionAdapter, KeywordSuggestion } from './types';

import { google, searchconsole_v1, Auth } from 'googleapis';

import { BaseExternalAdapter } from '../base';


/**
 * Google Search Console Keyword Adapter
 * Fetches search analytics data including keywords, impressions, clicks
 *
 * Required: GSC OAuth credentials + site verification
 */

export interface GSCCredentials {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken?: string | undefined;
}

export class GscAdapter extends BaseExternalAdapter implements KeywordIngestionAdapter {
  readonly source = 'gsc';
  private auth: Auth.OAuth2Client;
  private searchConsole: searchconsole_v1.Searchconsole;

  constructor(credentials?: GSCCredentials) {
    super('GscAdapter');

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
      credentials?.redirectUri ?? process.env['GSC_REDIRECT_URI'] ?? '',
    );

    if (credentials?.refreshToken) {
      this.auth.setCredentials({ refresh_token: credentials.refreshToken });
    }

    this.searchConsole = google.searchconsole({ version: 'v1', auth: this.auth });
  }

  /**
   * Generate OAuth URL for GSC authorization
   */
  getAuthUrl(state?: string): string {
    return this.auth.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/webmasters.readonly'],
      prompt: 'consent',
      ...(state ? { state } : {}),
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
    // are authenticated.
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
    validateNonEmptyString(domain, 'domain');

    return this.instrumented('fetch', async (context) => {
      // Ensure proper site URL format
      let siteUrl = domain;
      if (!siteUrl.startsWith('http')) {
        siteUrl = `https://${siteUrl}`;
      }
      if (!siteUrl.endsWith('/')) {
        siteUrl = `${siteUrl}/`;
      }

      // P1-4 FIX: log the normalised siteUrl, not the raw domain
      this.logger.info('Fetching keywords from GSC', context, { siteUrl, days });

      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const requestBody: searchconsole_v1.Schema$SearchAnalyticsQueryRequest = {
        startDate: startDate.toISOString().slice(0, 10),
        endDate: endDate.toISOString().slice(0, 10),
        dimensions: ['query'],
        rowLimit: 1000,
        aggregationType: 'auto',
      };

      const fetchPromise = this.searchConsole.searchanalytics.query({
        siteUrl,
        requestBody,
      });

      let timeoutId: ReturnType<typeof setTimeout>;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('GSC request timeout')), this.timeoutMs);
      });

      let response: Awaited<typeof fetchPromise>;
      try {
        response = await Promise.race([fetchPromise, timeoutPromise]);
      } catch (error: unknown) {
        clearTimeout(timeoutId!);
        // P1-3 FIX: googleapis (gaxios) places HTTP status on error.response.status
        const httpStatus =
          typeof error === 'object' && error !== null && 'response' in error
            ? (error as { response?: { status?: number } }).response?.status
            : undefined;
        const errCode =
          httpStatus ??
          (typeof error === 'object' && error !== null && 'code' in error
            ? (error as { code: unknown }).code
            : undefined);
        const errMessage = error instanceof Error ? error.message : String(error);

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
      } finally {
        clearTimeout(timeoutId!);
      }
      const rows = response.data.rows || [];

      const suggestions = rows
        .map((row): KeywordSuggestion => {
          const query = row.keys?.[0] ?? '';
          return {
            keyword: query,
            metrics: {
              clicks: row.clicks ?? 0,
              impressions: row.impressions ?? 0,
              ctr: row.ctr ?? 0,
              position: row.position ?? 0,
              source: 'gsc',
              fetchedAt: new Date().toISOString(),
              dateRange: {
                start: requestBody['startDate'] as string,
                end: requestBody['endDate'] as string,
              },
            },
          };
        })
        // P1-6 FIX: filter out empty-string keywords
        .filter(s => s.keyword !== '');

      this.logger.info('Successfully fetched keywords from GSC', context, {
        count: suggestions.length,
      });

      return suggestions;
    }, { domain, days });
  }

  /**
   * List sites verified in GSC
   */
  async listSites(): Promise<string[]> {
    return this.instrumented('listSites', async () => {
      const response = await this.searchConsole.sites.list();
      // P2-3 FIX: flatMap with guard drops entries where siteUrl is null/undefined
      return response.data.siteEntry?.flatMap(entry => entry.siteUrl ? [entry.siteUrl] : []) ?? [];
    });
  }

  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string | undefined }> {
    const start = Date.now();

    let timeoutId: ReturnType<typeof setTimeout>;
    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('Health check timeout')), 5000);
      });

      const checkPromise = this.listSites();
      await Promise.race([checkPromise, timeoutPromise]);

      return { healthy: true, latency: Date.now() - start };
    } catch (error: unknown) {
      const errMessage = error instanceof Error ? error.message : 'Unknown error';
      return {
        healthy: false,
        latency: Date.now() - start,
        error: errMessage,
      };
    } finally {
      clearTimeout(timeoutId!);
    }
  }
}

// Backward-compatible lazy-initialized singleton
// P1-7 NOTE: this singleton lives for the process lifetime. After secret rotation
// (GSC_CLIENT_ID / GSC_CLIENT_SECRET), the singleton continues using stale credentials
// until process restart. Call resetGscAdapter() immediately after rotating secrets.
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
