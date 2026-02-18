export const LINKEDIN_OAUTH_SCOPES = [
  'w_organization_social',
  'r_organization_social'
];

/**
 * P1-FIX: Strengthen state validation
 * Validates state parameter with minimum length and format checks
 * @param state - OAuth state parameter
 * @returns True if state is valid
 */
function validateState(state: string): boolean {
  // P1-FIX: Validate state length and format
  if (!state || state.length < 32) {
    return false;
  }
  return /^[a-zA-Z0-9_-]+$/.test(state);
}

function validateOAuthParams(clientId: string, redirectUri: string, state: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(clientId)) throw new Error('Invalid clientId');
  if (!redirectUri.startsWith('https://')) throw new Error('Invalid redirectUri');
  // Validate redirect URI against the allowlist. The env var is required in production;
  // an empty/missing value rejects all redirects rather than allowing any.
  const allowedDomains = (process.env['OAUTH_ALLOWED_REDIRECT_DOMAINS'] || '').split(',').filter(Boolean);
  const redirectHost = new URL(redirectUri).hostname;
  if (allowedDomains.length === 0 || !allowedDomains.some(d => redirectHost === d.trim() || redirectHost.endsWith('.' + d.trim()))) {
    throw new Error('Redirect URI domain not in allowlist');
  }
  // P1-FIX: Use strengthened state validation
  if (!validateState(state)) throw new Error('Invalid state');
}

export function getLinkedInAuthUrl(clientId: string, redirectUri: string, state: string) {
  validateOAuthParams(clientId, redirectUri, state);
  // P0-FIX: Include state parameter for CSRF protection
  const params = new URLSearchParams({
  response_type: 'code',
  client_id: clientId,
  redirect_uri: redirectUri,
  state: state,
  scope: LINKEDIN_OAUTH_SCOPES.join(' '),
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}
