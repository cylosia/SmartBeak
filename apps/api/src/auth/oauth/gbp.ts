import { ValidationError, ErrorCodes } from '@errors';

// P2-7: freeze to prevent scope escalation via Array.push() from any importer
export const GBP_OAUTH_SCOPES = Object.freeze([
  'https://www.googleapis.com/auth/business.manage',
] as const);

/**
 * Validates state parameter with minimum length and format checks.
 * Minimum 32 characters required for sufficient CSRF entropy.
 */
function validateState(state: string): boolean {
  if (!state || state.length < 32) {
    return false;
  }
  return /^[a-zA-Z0-9_-]+$/.test(state);
}

function validateOAuthParams(clientId: string, redirectUri: string, state: string) {
  // P0-1 FIX: Allow dots — real Google OAuth client IDs are formatted as
  // "<project-number>-<alphanum>.apps.googleusercontent.com" which contains dots.
  // The previous regex ^[a-zA-Z0-9_-]+$ rejected every valid production Google client ID.
  if (!/^[a-zA-Z0-9._-]+$/.test(clientId)) {
    throw new ValidationError('Invalid clientId', { code: ErrorCodes.VALIDATION_ERROR });
  }

  // P1-FIX (was TODO P2-5): enforce server-side redirect URI allowlist.
  // A bare `startsWith('https://')` check is insufficient — any HTTPS URL passes,
  // enabling authorization-code theft via open redirect. An attacker who supplies
  // redirectUri=https://attacker.com/steal receives the auth code from Google and
  // can exchange it for tokens tied to the victim's GBP account.
  // Mirror the pattern already used in linkedin.ts.
  if (!redirectUri.startsWith('https://')) {
    throw new ValidationError('Invalid redirectUri', { code: ErrorCodes.VALIDATION_ERROR });
  }
  const allowedDomains = (process.env['OAUTH_ALLOWED_REDIRECT_DOMAINS'] ?? '').split(',').filter(Boolean);
  if (allowedDomains.length > 0) {
    let redirectHost: string;
    try {
      redirectHost = new URL(redirectUri).hostname;
    } catch {
      throw new ValidationError('Invalid redirectUri', { code: ErrorCodes.VALIDATION_ERROR });
    }
    const allowed = allowedDomains.some(
      (d) => redirectHost === d.trim() || redirectHost.endsWith(`.${d.trim()}`)
    );
    if (!allowed) {
      throw new ValidationError('Redirect URI domain not in allowlist', { code: ErrorCodes.VALIDATION_ERROR });
    }
  }

  if (!validateState(state)) {
    throw new ValidationError('Invalid state', { code: ErrorCodes.VALIDATION_ERROR });
  }
}

export function getGbpAuthUrl(clientId: string, redirectUri: string, state: string) {
  validateOAuthParams(clientId, redirectUri, state);
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: GBP_OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    // P2-6 FIX: include prompt=consent so Google re-issues a refresh_token on every
    // authorization, not only the first. Without this, users who revoke and re-authorize
    // never receive a new refresh_token, permanently breaking their GBP connection.
    prompt: 'consent',
    state: state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
