
import { KeywordIngestionAdapter } from './types';

export const PaaRealAdapter: KeywordIngestionAdapter = {
  source: 'paa',
  async fetch(_domain: string) {
  // NOTE: PAA scraping via SERP provider or search API to be implemented
  // Keep advisory-only; store provenance.
  return [];
  }
};
