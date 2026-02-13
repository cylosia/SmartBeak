
import { z } from 'zod';
const FormIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).min(5).max(50);

const CDN_BASE_URL = process.env['CDN_BASE_URL'] || 'https://cdn.acp.io';
const FORMS_BASE_URL = process.env['FORMS_BASE_URL'] || 'https://acp.io';

export function generateOptinEmbed(formId: string) {
  const validatedFormId = FormIdSchema.parse(formId);
  return {
  script: `<script src='${CDN_BASE_URL}/forms/${validatedFormId}.js'></script>`,
  iframe: `<iframe src='${FORMS_BASE_URL}/forms/${validatedFormId}' width='400' height='300'></iframe>`
  };
}
