
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
  const errors = result.error.issues.map(e => `${e.path.join('.')}: ${e.message}`).join(', ');
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
// P2-FIX: Read and validate weight/target constants ONCE at module load.
// Previously computed inside the function body on every call, which:
//   1. Re-parsed env vars on a hot path for no benefit.
//   2. Silently produced NaN: Number('abc') === NaN, propagating through all
//      arithmetic and serialising to JSON null — corrupting buyer SEO reports.
function readSeoEnv(key: string, defaultVal: number): number {
  const raw = process.env[key];
  if (raw === undefined || raw === null || raw === '') return defaultVal;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    // P2-FIX: Do not include the raw env var value in the error message — it
    // may propagate to logs/clients and expose configuration internals.
    throw new Error(`${key} must be a non-negative finite number`);
  }
  return n;
}

const PAGE_WEIGHT = readSeoEnv('SEO_PAGE_WEIGHT', 25);
const PAGE_TARGET = readSeoEnv('SEO_PAGE_TARGET', 50);
const CLUSTER_WEIGHT = readSeoEnv('SEO_CLUSTER_WEIGHT', 25);
const CLUSTER_TARGET = readSeoEnv('SEO_CLUSTER_TARGET', 20);
const FRESHNESS_WEIGHT = readSeoEnv('SEO_FRESHNESS_WEIGHT', 25);
const SCHEMA_WEIGHT = readSeoEnv('SEO_SCHEMA_WEIGHT', 25);

export function computeSeoCompleteness(input: {
  pages: number;
  clusters: number;
  updated_ratio: number;
  schema_coverage: number;
}): number {

  const validated = validateInput(input);

  let score = 0;
  // Division by zero protection — use safe division with targets
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
