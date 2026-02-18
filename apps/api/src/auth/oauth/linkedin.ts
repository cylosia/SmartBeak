import { timingSafeEqual, randomBytes } from 'crypto';

export const LINKEDIN_OAUTH_SCOPES = [
  'w_organization_social',
  'r_organization_social'
];

/**
 * Generate a cryptographically secure state parameter for OAuth CSRF protection.
 * The caller must store this in the user's session for verification on callback.
 */
export function generateOAuthState(): string {
  return randomBytes(32).toString('hex');
}

/**
 * Validates state parameter format (minimum length and charset).
 * NOTE: Format validation alone is NOT sufficient for CSRF protection.
 * The caller must also verify the state matches the session-stored value.
 */
function validateState(state: string): boolean {
  if (!state || state.length < 32) {
    return false;
  }
  return /^[a-zA-Z0-9_-]+$/.test(state);
}

function validateOAuthParams(clientId: string, redirectUri: string, state: string): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(clientId)) throw new Error('Invalid clientId');
  if (!redirectUri.startsWith('https://')) throw new Error('Invalid redirectUri');

  // Fail closed: redirect domain allowlist MUST be configured
  const allowedDomains = (process.env['OAUTH_ALLOWED_REDIRECT_DOMAINS'] || '').split(',').filter(Boolean);
  if (allowedDomains.length === 0) {
    throw new Error('OAUTH_ALLOWED_REDIRECT_DOMAINS must be configured');
  }
  const redirectHost = new URL(redirectUri).hostname;
  // Exact match only — no subdomain wildcarding to prevent subdomain takeover bypass
  if (!allowedDomains.some(d => redirectHost === d.trim())) {
    throw new Error('Redirect URI domain not in allowlist');
  }

  if (!validateState(state)) throw new Error('Invalid state');
}

export function getLinkedInAuthUrl(clientId: string, redirectUri: string, state: string): string {
  validateOAuthParams(clientId, redirectUri, state);
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    state: state,
    scope: LINKEDIN_OAUTH_SCOPES.join(' '),
  });
  return `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
}

export interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string | undefined;
  scope: string;
}

/**
 * Exchange an authorization code for an access token.
 * Verifies the state parameter against the session-stored value using constant-time comparison.
 */
export async function exchangeLinkedInCode(
  code: string,
  state: string,
  storedState: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string
): Promise<LinkedInTokenResponse> {
  // Constant-time state comparison to prevent timing attacks
  const stateBuffer = Buffer.from(state);
  const storedBuffer = Buffer.from(storedState);
  if (stateBuffer.length !== storedBuffer.length || !timingSafeEqual(stateBuffer, storedBuffer)) {
    throw new Error('State mismatch - possible CSRF attack');
  }

  const tokenUrl = 'https://www.linkedin.com/oauth/v2/accessToken';
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => 'Unknown error');
    throw new Error(`LinkedIn token exchange failed: ${response.status} ${errorText}`);
  }

  const tokenData = await response.json() as LinkedInTokenResponse;
  return tokenData;
}
