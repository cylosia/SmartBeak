export type SerpSnapshot = {
  keyword: string;
  urls: string[];
};

export function computeSerpVolatility(prev: SerpSnapshot, curr: SerpSnapshot): number {
  const prevSet = new Set(prev.urls);
  const _currSet = new Set(curr.urls);

  let changes = 0;
  curr.urls.forEach(u => {
  if (!prevSet.has(u)) changes++;
  });

  const max = Math.max(prev.urls.length, 1);
  return Math.round((changes / max) * 100);
}

export function classifyVolatility(score: number): 'stable' | 'moderate' | 'volatile' {
  if (score < 20) return 'stable';
  if (score < 50) return 'moderate';
  return 'volatile';
}
