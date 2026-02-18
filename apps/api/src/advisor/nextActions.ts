import { z } from 'zod';

export const AdvisorSignalSchema = z.object({
  content_id: z.string().min(1),
  traffic: z.number().nonnegative(),
  roi_12mo: z.number(),
  freshness_days: z.number().nonnegative(),
  decay: z.boolean(),
  serp_volatility: z.enum(['stable', 'moderate', 'volatile']),
});

export type AdvisorSignal = z.infer<typeof AdvisorSignalSchema>;

// 'create' removed: this function scores existing content — creation is out of scope
export type AdvisorRecommendation = {
  content_id: string;
  action: 'refresh' | 'expand' | 'prune';
  priority_score: number;
  explanation: string[];
};

export function recommendNextActions(
  signals: AdvisorSignal[]
): AdvisorRecommendation[] {
  return signals
  .map(s => {
    let score = 0;
    const explanation: string[] = [];

    if (s.decay) {
    score += 30;
    explanation.push('Traffic is declining');
    }
    if (s.freshness_days > 365) {
    score += 20;
    explanation.push('Content has not been reviewed in over a year');
    }
    if (s.traffic > 1000 && s.roi_12mo > 0) {
    score += 25;
    explanation.push('High-traffic content with positive ROI');
    }
    if (s.roi_12mo < 0) {
    score += 15;
    explanation.push('Negative ROI opportunity to improve or prune');
    }
    if (s.serp_volatility === 'stable') {
    score += 10;
    explanation.push('SERP is stable, changes are more predictable');
    }

    let action: AdvisorRecommendation['action'] = 'refresh';
    if (s.traffic > 1000 && s.roi_12mo > 50) action = 'expand';
    if (s.traffic < 50 && s.roi_12mo < 0) action = 'prune';

    return {
    content_id: s.content_id,
    action,
    priority_score: score,
    explanation,
    };
  })
  .sort((a, b) => b.priority_score - a.priority_score);
}
