
import { z } from 'zod';

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
* @param variants - Array of experiment variants
* @throws Error if validation fails
*/
export function validateExperiment(variants: unknown[]): void {
  // Validate variants array structure
  const validatedVariants = VariantsSchema.parse(variants);

  if (validatedVariants.length < 2) {
  throw new Error('At least two variants required');
  }

  const intents = new Set(validatedVariants.map(v => v.intent));
  const types = new Set(validatedVariants.map(v => v.contentType));

  if (intents.size > 1) {
  throw new Error('All variants must share the same intent');
  }

  if (types.size > 1) {
  throw new Error('All variants must share the same content type');
  }
}
