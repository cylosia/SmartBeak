export const MEDIA_LIMITS: Record<string, { mediaTargets: number }> = {
  free: { mediaTargets: 1 },
  pro: { mediaTargets: 5 },
  agency: { mediaTargets: Infinity }
};

export function assertMediaLimit(plan: string, requested: number) {
  const limit = MEDIA_LIMITS[plan]?.mediaTargets ?? 0;
  if (requested > limit) {
  throw new Error('Media publish limit exceeded for plan');
  }
}
