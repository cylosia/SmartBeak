export type KeywordSuggestion = {
  keyword: string;
  metrics?: Record<string, unknown>;
};

export interface KeywordIngestionAdapter {
  source: string;
  fetch(domain: string): Promise<KeywordSuggestion[]>;
};
