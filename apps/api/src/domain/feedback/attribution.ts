/**
* Page metrics input
*/
export interface PageMetrics {
  impressions?: number;
  clicks?: number;
  ctr?: number | null;
  partial?: boolean;
  [key: string]: unknown;
}

/**
* Attributed page metrics result
*/
export interface AttributedMetrics {
  impressions: number;
  clicks: number;
  ctr: number | null;
  confidence: 'partial' | 'full';
}

/**
* Attribute page metrics
* @param metrics - Page metrics input
* @returns Attributed metrics
*/
export function attributePageMetrics(metrics: PageMetrics): AttributedMetrics {
  return {
  impressions: metrics.impressions ?? 0,
  clicks: metrics.clicks ?? 0,
  ctr: metrics.ctr ?? null,
  confidence: metrics.partial ? 'partial' : 'full'
  };
}
