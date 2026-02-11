

import fetch from 'node-fetch';

import { KeywordIngestionAdapter } from './types';

export const GscRealAdapter: KeywordIngestionAdapter = {
  source: 'gsc',
  async fetch(domain: string) {
  // NOTE: GSC API implementation using OAuth credentials pending
  // Requires property verification; ingest impressions/clicks for decay.
  return [];
  }
};
