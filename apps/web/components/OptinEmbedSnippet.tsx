
import React from 'react';
import { cdnConfig } from '@config';

function isValidFormId(formId: string): boolean {
  // Allow only alphanumeric characters and hyphens
  const validFormIdRegex = /^[a-zA-Z0-9-]+$/;
  return validFormIdRegex.test(formId);
}

function sanitizeFormId(formId: string): string {
  // Remove any characters that aren't alphanumeric or hyphen
  return formId.replace(/[^a-zA-Z0-9-]/g, '');
}

const CDN_BASE_URL = cdnConfig.cdnBaseUrl;
const FORMS_BASE_URL = cdnConfig.formsBaseUrl;

export function OptinEmbedSnippet({ formId }: { formId: string }) {

  if (!formId || !isValidFormId(formId)) {
  return (
    <div>
    <h3>Embed Opt-in Form</h3>
    <p style={{ color: 'red' }}>Invalid form ID. Form ID must contain only letters, numbers, and hyphens.</p>
    </div>
  );
  }

  const sanitizedFormId = sanitizeFormId(formId);
  const script = `<script src='${CDN_BASE_URL}/forms/${sanitizedFormId}.js'></script>`;
  const iframe = `<iframe src='${FORMS_BASE_URL}/forms/${sanitizedFormId}' width='400' height='300' sandbox='allow-scripts allow-same-origin allow-forms' loading='lazy' referrerpolicy='no-referrer'></iframe>`;

  return (
  <div>
    <h3>Embed Opt-in Form</h3>
    <textarea readOnly value={script} />
    <textarea readOnly value={iframe} />
  </div>
  );
}
