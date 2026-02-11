export type KeywordSuggestion = {
  keyword: string;
  metrics?: Record<string, any>;
};

export interface KeywordIngestionAdapter {
  source: string;
  fetch(domain: string): Promise<KeywordSuggestion[]>;
};
