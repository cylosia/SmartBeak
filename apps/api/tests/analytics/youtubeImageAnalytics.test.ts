import { describe, test, expect } from 'vitest';

import { computeYouTubeThumbnailCtr, YouTubeCtrInputSchema } from '../../src/analytics/images/youtubeImageAnalytics';

describe('computeYouTubeThumbnailCtr', () => {
  test('calculates correct CTR', () => {
    expect(computeYouTubeThumbnailCtr({ impressions: 1000, views: 50 })).toBe(5);
  });

  test('returns 0 when impressions is zero', () => {
    expect(computeYouTubeThumbnailCtr({ impressions: 0, views: 0 })).toBe(0);
  });

  test('rounds to one decimal place', () => {
    // 33 / 1000 = 0.033 => 3.3%
    expect(computeYouTubeThumbnailCtr({ impressions: 1000, views: 33 })).toBe(3.3);
  });

  test('returns 100 when views equals impressions', () => {
    expect(computeYouTubeThumbnailCtr({ impressions: 100, views: 100 })).toBe(100);
  });

  // P2-3 FIX: CTR is capped at 100%
  test('caps CTR at 100% when views exceed impressions', () => {
    const result = computeYouTubeThumbnailCtr({ impressions: 100, views: 150 });
    expect(result).toBe(100);
  });

  test('throws on negative inputs', () => {
    expect(() => computeYouTubeThumbnailCtr({ impressions: -1, views: 0 })).toThrow();
  });

  test('throws on non-integer inputs', () => {
    expect(() => computeYouTubeThumbnailCtr({ impressions: 1.5, views: 0 })).toThrow();
  });

  test('handles large values', () => {
    const result = computeYouTubeThumbnailCtr({ impressions: 1_000_000, views: 50_000 });
    expect(result).toBe(5);
  });
});

describe('YouTubeCtrInputSchema', () => {
  test('validates correct input', () => {
    expect(YouTubeCtrInputSchema.parse({ impressions: 100, views: 50 })).toEqual({ impressions: 100, views: 50 });
  });

  test('rejects missing fields', () => {
    expect(() => YouTubeCtrInputSchema.parse({ impressions: 100 })).toThrow();
  });

  // P3-2 FIX (audit 2): MAX_SAFE_INTEGER boundary tests
  test('accepts MAX_SAFE_INTEGER values', () => {
    const result = computeYouTubeThumbnailCtr({
      impressions: Number.MAX_SAFE_INTEGER,
      views: Number.MAX_SAFE_INTEGER,
    });
    expect(result).toBe(100);
  });

  test('rejects values above MAX_SAFE_INTEGER', () => {
    expect(() => computeYouTubeThumbnailCtr({
      impressions: Number.MAX_SAFE_INTEGER + 1,
      views: 0,
    })).toThrow();
  });

  // P3-3 FIX (audit 2): .strict() rejects extra properties
  test('rejects extra properties with .strict() (P2-1)', () => {
    expect(() => YouTubeCtrInputSchema.parse({
      impressions: 100,
      views: 50,
      clicks: 30,
    })).toThrow();
  });
});
