
import React from 'react';
import { cdnConfig } from '@config';

const MAX_FORM_ID_LENGTH = 128;

function isValidFormId(formId: string): boolean {
  if (formId.length > MAX_FORM_ID_LENGTH) return false;
  // Must start and end with alphanumeric; no consecutive or leading/trailing hyphens
  return /^[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(formId);
}

const CDN_BASE_URL = cdnConfig.cdnBaseUrl;
const FORMS_BASE_URL = cdnConfig.formsBaseUrl;

export function OptinEmbedSnippet({ formId }: { formId: string }) {

  // P2-9: Guard against undefined env vars producing literal "undefined" in URLs,
  // and reject non-HTTPS base URLs to prevent mixed-content or protocol injection.
  if (!CDN_BASE_URL?.startsWith('https://') || !FORMS_BASE_URL?.startsWith('https://')) {
    return (
      <div>
        <h3>Embed Opt-in Form</h3>
        <p style={{ color: 'red' }}>Embed configuration is unavailable. Please contact support.</p>
      </div>
    );
  }

  if (!formId || !isValidFormId(formId)) {
    return (
      <div>
        <h3>Embed Opt-in Form</h3>
        <p style={{ color: 'red' }}>Invalid form ID. Form ID must contain only letters, numbers, and hyphens, and be at most {MAX_FORM_ID_LENGTH} characters.</p>
      </div>
    );
  }

  // P3-11: sanitizeFormId removed — isValidFormId already guarantees the string
  // contains only [a-zA-Z0-9-], so sanitization is redundant and creates a false
  // impression of defence-in-depth.
  const script = `<script src='${CDN_BASE_URL}/forms/${formId}.js'></script>`;
  // P0-6: Removed allow-same-origin from sandbox. Combining allow-scripts with
  // allow-same-origin nullifies sandboxing — scripts can remove the sandbox attribute
  // and gain full parent-page DOM access, cookies, and localStorage.
  const iframe = `<iframe title='Opt-in Form' src='${FORMS_BASE_URL}/forms/${formId}' width='400' height='300' sandbox='allow-scripts allow-forms' loading='lazy' referrerpolicy='no-referrer'></iframe>`;

  return (
    <div>
      <h3>Embed Opt-in Form</h3>
      <textarea readOnly value={script} />
      <textarea readOnly value={iframe} />
    </div>
  );
}
