
import { z } from 'zod';
const FormIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).min(5).max(50);

export function generateOptinEmbed(formId: string) {
  const validatedFormId = FormIdSchema.parse(formId);
  return {
  script: `<script src='https://cdn.acp.io/forms/${validatedFormId}.js'></script>`,
  iframe: `<iframe src='https://acp.io/forms/${validatedFormId}' width='400' height='300'></iframe>`
  };
}
