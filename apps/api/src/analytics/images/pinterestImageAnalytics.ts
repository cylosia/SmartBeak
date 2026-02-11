
import { z } from 'zod';
const PinterestCtrInputSchema = z.object({
  impressions: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  clicks: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
});

export async function computePinterestImageCtr(input: {
  impressions: number;
  clicks: number;
}) {
  const validated = PinterestCtrInputSchema.parse(input);

  if (validated.impressions === 0) return 0;
  return Math.round((validated.clicks / validated.impressions) * 1000) / 10;
}
