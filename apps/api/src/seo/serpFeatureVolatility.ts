export type FeatureSnapshot = {
  date: string;
  features: string[];
};

export function computeFeatureVolatility(
  prev: FeatureSnapshot,
  curr: FeatureSnapshot
) {
  const prevSet = new Set(prev.features);
  const currSet = new Set(curr.features);

  const added = curr.features.filter(f => !prevSet.has(f));
  const removed = prev.features.filter(f => !currSet.has(f));

  return {
  volatility_score: added.length + removed.length
  };
}
