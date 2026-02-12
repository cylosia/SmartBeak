
// Input validation schema for SEO completeness calculation
import { z } from 'zod';
const SeoCompletenessInputSchema = z.object({
  pages: z.number().int().min(0, 'Pages must be a non-negative integer'),
  clusters: z.number().int().min(0, 'Clusters must be a non-negative integer'),
  updated_ratio: z.number().min(0).max(1, 'Updated ratio must be between 0 and 1'),
  schema_coverage: z.number().min(0).max(1, 'Schema coverage must be between 0 and 1'),
});

export type SeoCompletenessInput = z.infer<typeof SeoCompletenessInputSchema>;

/**
* Validates SEO completeness input and throws if invalid
*/
function validateInput(input: unknown): SeoCompletenessInput {
  const result = SeoCompletenessInputSchema.safeParse(input);

  if (!result.success) {
  const errors = result.error.issues.map(e => `${e.path.join('.')}: ${e["message"]}`).join(', ');
  throw new Error(`Invalid SEO completeness input: ${errors}`);
  }

  return result.data;
}

/**
* Computes SEO completeness score based on various metrics
*
* @param input - The input metrics for SEO completeness
* @returns A score between 0-100 representing SEO completeness
* @throws Error if input validation fails
*/
export function computeSeoCompleteness(input: {
  pages: number;
  clusters: number;
  updated_ratio: number;
  schema_coverage: number;
}): number {

  const validated = validateInput(input);

  // P1-FIX: Use ?? instead of || so that explicitly setting a weight to 0 works.
  // With ||, Number('0') is falsy so it falls back to the default, making 0 unreachable.
  const PAGE_WEIGHT = Number(process.env['SEO_PAGE_WEIGHT'] ?? 25);
  const PAGE_TARGET = Number(process.env['SEO_PAGE_TARGET'] ?? 50);
  const CLUSTER_WEIGHT = Number(process.env['SEO_CLUSTER_WEIGHT'] ?? 25);
  const CLUSTER_TARGET = Number(process.env['SEO_CLUSTER_TARGET'] ?? 20);
  const FRESHNESS_WEIGHT = Number(process.env['SEO_FRESHNESS_WEIGHT'] ?? 25);
  const SCHEMA_WEIGHT = Number(process.env['SEO_SCHEMA_WEIGHT'] ?? 25);

  let score = 0;
  // FIX: Division by zero protection - use safe division with targets
  score += Math.min(
  PAGE_TARGET > 0 ? (validated.pages / PAGE_TARGET) * PAGE_WEIGHT : 0,
  PAGE_WEIGHT
  );
  score += Math.min(
  CLUSTER_TARGET > 0 ? (validated.clusters / CLUSTER_TARGET) * CLUSTER_WEIGHT : 0,
  CLUSTER_WEIGHT
  );
  score += validated.updated_ratio * FRESHNESS_WEIGHT;
  score += validated.schema_coverage * SCHEMA_WEIGHT;
  return Math.round(score);
}

// Export schema for reuse in other modules
export { SeoCompletenessInputSchema };
