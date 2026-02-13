
import { z } from 'zod';
import { cdnConfig } from '@config';

const FormIdSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/).min(5).max(50);

const CDN_BASE_URL = cdnConfig.cdnBaseUrl;
const FORMS_BASE_URL = cdnConfig.formsBaseUrl;

export function generateOptinEmbed(formId: string) {
  const validatedFormId = FormIdSchema.parse(formId);
  return {
  script: `<script src='${CDN_BASE_URL}/forms/${validatedFormId}.js'></script>`,
  iframe: `<iframe src='${FORMS_BASE_URL}/forms/${validatedFormId}' width='400' height='300'></iframe>`
  };
}
