import { recommendNextActions, AdvisorSignalSchema } from './nextActions';

const baseSignal = {
  content_id: 'c1',
  traffic: 500,
  roi_12mo: 10,
  freshness_days: 100,
  decay: false,
  serp_volatility: 'stable' as const,
};

test('returns empty array for empty input', () => {
  expect(recommendNextActions([])).toEqual([]);
});

test('recommends refresh for decaying content', () => {
  const result = recommendNextActions([{ ...baseSignal, decay: true }]);
  expect(result[0]?.action).toBe('refresh');
  expect(result[0]?.explanation).toContain('Traffic is declining');
});

test('recommends expand for high-traffic positive ROI content', () => {
  const result = recommendNextActions([{ ...baseSignal, traffic: 2000, roi_12mo: 100 }]);
  expect(result[0]?.action).toBe('expand');
});

test('recommends prune for low-traffic negative ROI content', () => {
  const result = recommendNextActions([{ ...baseSignal, traffic: 10, roi_12mo: -5 }]);
  expect(result[0]?.action).toBe('prune');
});

test('sorts by priority_score descending', () => {
  const signals = [
    { ...baseSignal, content_id: 'low', decay: false, freshness_days: 10 },
    { ...baseSignal, content_id: 'high', decay: true, freshness_days: 400 },
  ];
  const result = recommendNextActions(signals);
  expect(result[0]?.content_id).toBe('high');
});

test('AdvisorSignalSchema validates correct input', () => {
  expect(() => AdvisorSignalSchema.parse(baseSignal)).not.toThrow();
});

test('AdvisorSignalSchema rejects negative traffic', () => {
  expect(() => AdvisorSignalSchema.parse({ ...baseSignal, traffic: -1 })).toThrow();
});

test('AdvisorSignalSchema rejects invalid serp_volatility', () => {
  expect(() => AdvisorSignalSchema.parse({ ...baseSignal, serp_volatility: 'unknown' })).toThrow();
});
