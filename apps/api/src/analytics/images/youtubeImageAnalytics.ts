
import { z } from 'zod';

export const YouTubeCtrInputSchema = z.object({
  impressions: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  views: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
});

export function computeYouTubeThumbnailCtr(input: {
  impressions: number;
  views: number;
}): number {
  const validated = YouTubeCtrInputSchema.parse(input);

  if (validated.impressions === 0) return 0;
  // P2-3 FIX: Cap CTR at 100% — views can exceed impressions due to
  // YouTube analytics data timing differences, producing nonsensical values.
  const rawCtr = Math.round((validated.views / validated.impressions) * 1000) / 10;
  return Math.min(rawCtr, 100);
}
