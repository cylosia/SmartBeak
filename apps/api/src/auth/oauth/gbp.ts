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
  if (!redirectUri.startsWith('https://')) {
    throw new ValidationError('Invalid redirectUri', { code: ErrorCodes.VALIDATION_ERROR });
  }
  // SEC FIX (P0): Enforce a server-side allowlist of approved redirect URI hostnames to
  // close the open-redirect vulnerability. Without an allowlist, any attacker who obtains
  // the clientId (compiled into apps, leaked in logs) can direct the OAuth flow to
  // https://attacker.com/callback and exchange the authorization code for a refresh token,
  // gaining permanent write access to the victim's Google Business Profile.
  // Set OAUTH_GBP_REDIRECT_ALLOWLIST to a comma-separated list of approved hostnames,
  // e.g. "app.example.com,staging.example.com". If the env var is unset the check is
  // skipped (backwards-compatible default), but it MUST be set in production.
  const allowedDomains = (process.env['OAUTH_GBP_REDIRECT_ALLOWLIST'] ?? '')
    .split(',')
    .map((d: string) => d.trim())
    .filter(Boolean);
  if (allowedDomains.length > 0) {
    let redirectHost: string;
    try {
      redirectHost = new URL(redirectUri).hostname;
    } catch {
      throw new ValidationError('Invalid redirectUri: malformed URL', { code: ErrorCodes.VALIDATION_ERROR });
    }
    const allowed = allowedDomains.some(
      (d: string) => redirectHost === d || redirectHost.endsWith('.' + d)
    );
    if (!allowed) {
      throw new ValidationError('Invalid redirectUri: domain not in allowlist', { code: ErrorCodes.VALIDATION_ERROR });
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
