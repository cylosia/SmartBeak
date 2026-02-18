import { z } from 'zod';
import { ValidationError, ErrorCodes } from '@errors';

const VariantSchema = z.object({
  intent: z.string().min(1).max(200),
  contentType: z.enum(['article', 'video', 'podcast', 'social'])
});

const VariantsSchema = z.array(VariantSchema).min(2).max(10);

/**
* Experiment variant type inferred from schema
*/
export type ExperimentVariant = z.infer<typeof VariantSchema>;

/**
* Validate experiment variants
* P2-6 FIX: Removed redundant length check (Zod already enforces min(2))
* P2-7 FIX: Added comment clarifying business requirement for same-dimension experiments
* @param variants - Array of experiment variants
* @throws Error if validation fails
*/
export function validateExperiment(variants: unknown[]): void {
  // Validate variants array structure (enforces 2-10 elements via Zod schema)
  const validatedVariants = VariantsSchema.parse(variants);

  const intents = new Set(validatedVariants.map(v => v.intent));
  const types = new Set(validatedVariants.map(v => v.contentType));

  // Business rule: Variants in an experiment must target the same intent.
  // Different intents should be modeled as separate experiments.
  // P1-4 FIX: Throw ValidationError (→ HTTP 400) instead of plain Error (→ HTTP 500).
  if (intents.size > 1) {
    throw new ValidationError(
      'All variants must share the same intent',
      undefined,
      ErrorCodes.VALIDATION_ERROR
    );
  }

  // Business rule: Variants must share the same content type.
  // P1-4 FIX: Throw ValidationError (→ HTTP 400) instead of plain Error (→ HTTP 500).
  if (types.size > 1) {
    throw new ValidationError(
      'All variants must share the same content type',
      undefined,
      ErrorCodes.VALIDATION_ERROR
    );
  }
}
