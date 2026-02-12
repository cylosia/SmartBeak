import { KeywordIngestionAdapter } from './types';

/**
 * Stub GSC adapter -- not yet implemented.
 * Use the main GscAdapter from ./gsc.ts for production GSC integration.
 */
export const GscRealAdapter: KeywordIngestionAdapter = {
  source: 'gsc',
  async fetch(_domain: string) {
  // TODO: GSC API implementation using OAuth credentials pending
  // Requires property verification; ingest impressions/clicks for decay.
  return [];
  }
};
