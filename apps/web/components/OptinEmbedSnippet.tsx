
import React from 'react';
import { cdnConfig } from '@config';

function isValidFormId(formId: string): boolean {
  // SECURITY FIX (OES-4): Require at least one leading alphanumeric character
  // (prevents all-hyphen IDs such as "---"), enforce a maximum length of 64, and
  // reject strings longer than 64 characters to prevent oversized embed URLs.
  if (formId.length < 1 || formId.length > 64) return false;
  const validFormIdRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]*$/;
  return validFormIdRegex.test(formId);
}

const CDN_BASE_URL = cdnConfig.cdnBaseUrl;
const FORMS_BASE_URL = cdnConfig.formsBaseUrl;

export function OptinEmbedSnippet({ formId }: { formId: string }) {

  // Guard against misconfigured CDN/Forms URLs — rendering snippets with
  // literal "undefined" in the URL silently produces broken embeds.
  if (!CDN_BASE_URL || !FORMS_BASE_URL) {
  return (
    <div>
    <h3>Embed Opt-in Form</h3>
    <p style={{ color: 'red' }}>Embed configuration error: CDN URLs are not configured.</p>
    </div>
  );
  }

  if (!formId || !isValidFormId(formId)) {
  return (
    <div>
    <h3>Embed Opt-in Form</h3>
    <p style={{ color: 'red' }}>Invalid form ID. Form ID must start with a letter or number and contain only letters, numbers, and hyphens (max 64 characters).</p>
    </div>
  );
  }

  // formId is now validated: starts with [a-zA-Z0-9], contains only [a-zA-Z0-9-],
  // length 1-64. No further sanitization is needed; omit the old sanitizeFormId
  // helper which was dead code (validation always passed or rejected before it ran).
  const script = `<script src='${CDN_BASE_URL}/forms/${formId}.js'></script>`;
  // SECURITY FIX (OES-1): Removed `allow-same-origin` from the iframe sandbox.
  // Combining `allow-scripts` with `allow-same-origin` completely defeats the
  // sandbox — scripts inside the iframe could access the parent document's
  // cookies and tokens.  The embedded form only needs to run scripts and submit
  // forms; same-origin access is not required and must not be granted.
  const iframe = `<iframe src='${FORMS_BASE_URL}/forms/${formId}' width='400' height='300' sandbox='allow-scripts allow-forms allow-popups' loading='lazy' referrerpolicy='no-referrer'></iframe>`;

  return (
  <div>
    <h3>Embed Opt-in Form</h3>
    <textarea readOnly value={script} />
    <textarea readOnly value={iframe} />
  </div>
  );
}
