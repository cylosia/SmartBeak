/**
* Raw SERP result item
*/
export interface SerpResultItem {
  url: string;
  title: string;
  [key: string]: unknown;
}

/**
* Raw SERP data
*/
export interface RawSerpData {
  results: SerpResultItem[];
  features?: Record<string, unknown>;
}

/**
* Normalized SERP result
*/
export interface NormalizedSerpResult {
  url: string;
  title: string;
}

/**
* Normalized SERP data
*/
export interface NormalizedSerp {
  results: NormalizedSerpResult[];
  features: Record<string, unknown>;
}

/** Maximum number of SERP results to include in normalization */
const MAX_SERP_RESULTS = 10;

/**
* Normalize SERP data
* @param raw - Raw SERP data
* @returns Normalized SERP data
*/
export function normalizeSerp(raw: RawSerpData): NormalizedSerp {
  return {
  results: raw.results.slice(0, MAX_SERP_RESULTS).map((r: SerpResultItem) => ({
    url: r["url"],
    title: r.title
  })),
  features: raw.features ?? {}
  };
}
