
import { z } from 'zod';
const YouTubeCtrInputSchema = z.object({
  impressions: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  views: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
});

export async function computeYouTubeThumbnailCtr(input: {
  impressions: number;
  views: number;
}) {
  const validated = YouTubeCtrInputSchema.parse(input);

  if (validated.impressions === 0) return 0;
  return Math.round((validated.views / validated.impressions) * 1000) / 10;
}
