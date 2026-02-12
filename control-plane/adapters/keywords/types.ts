export type KeywordSuggestion = {
  keyword: string;
  // P1-11 FIX: Changed from `any` to `unknown` for type safety
  metrics?: Record<string, unknown>;
};

export interface KeywordIngestionAdapter {
  source: string;
  fetch(domain: string): Promise<KeywordSuggestion[]>;
};
