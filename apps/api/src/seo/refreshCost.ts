



export interface RefreshCostInput {
  current_words: number;
  target_words: number;
  serp_volatility: 'stable' | 'moderate' | 'volatile';
}

export type RefreshCostEstimate = {
  word_delta: number;
  research_level: 'low' | 'medium' | 'high';
  media_required: boolean;
  estimated_hours: number;
};

export function estimateRefreshCost(input: RefreshCostInput): RefreshCostEstimate {
  const word_delta = Math.max(input.target_words - input.current_words, 0);
  let hours = word_delta / 500;
  if (input.serp_volatility === 'moderate')
    hours += 1;
  if (input.serp_volatility === 'volatile')
    hours += 2;
  return {
    word_delta,
    research_level: input.serp_volatility === 'volatile' ? 'high' : 'medium',
    media_required: word_delta > 800,
    estimated_hours: Math.round(hours * 10) / 10
  };
}
