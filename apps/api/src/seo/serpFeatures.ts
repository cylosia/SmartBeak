export type SerpFeature = 'featured_snippet' | 'paa' | 'video' | 'image' | 'faq';

/**
* SERP result item from API
*/
export interface SerpResultItem {
  type?: string;
  position?: number;
  url?: string;
  title?: string;
  snippet?: string;
}

/**
* Detect SERP feature opportunities from search results
* @param serp - Array of SERP result items
* @returns Array of detected SERP features
*/
export function detectSerpOpportunities(serp: SerpResultItem[]): SerpFeature[] {
  const features: SerpFeature[] = [];
  serp.forEach(r => {
  if (r.type === 'featured_snippet') features.push('featured_snippet');
  if (r.type === 'paa') features.push('paa');
  if (r.type === 'video') features.push('video');
  if (r.type === 'image') features.push('image');
  });
  return [...new Set(features)];
}
