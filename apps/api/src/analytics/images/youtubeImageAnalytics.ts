import { z } from 'zod';

/** P2-1 FIX (audit 2): .strict() rejects unexpected properties instead of silently stripping them */
export const YouTubeCtrInputSchema = z.object({
  impressions: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  views: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
}).strict();

/**
 * P2-10 FIX (audit 2): Parameter type derived from Zod schema to prevent drift.
 * P3-3 FIX (audit 4): Use z.output (post-transform type) instead of z.input
 * (pre-transform type). Currently identical since the schema has no transforms,
 * but z.output is semantically correct and will remain correct if coercions are
 * ever added to the schema.
 */
export function computeYouTubeThumbnailCtr(input: z.output<typeof YouTubeCtrInputSchema>): number {
  const validated = YouTubeCtrInputSchema.parse(input);

  if (validated.impressions === 0) return 0;
  // P2-3 FIX: Cap CTR at 100% — views can exceed impressions due to
  // YouTube analytics data timing differences, producing nonsensical values.
  const rawCtr = Math.round((validated.views / validated.impressions) * 1000) / 10;
  return Math.min(rawCtr, 100);
}
