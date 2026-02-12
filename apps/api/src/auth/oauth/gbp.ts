export const GBP_OAUTH_SCOPES = [
  'https://www.googleapis.com/auth/business.manage'
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
  // P1-FIX: Use strengthened state validation
  if (!validateState(state)) throw new Error('Invalid state');
}

export function getGbpAuthUrl(clientId: string, redirectUri: string, state: string) {
  validateOAuthParams(clientId, redirectUri, state);
  const params = new URLSearchParams({
  client_id: clientId,
  redirect_uri: redirectUri,
  response_type: 'code',
  scope: GBP_OAUTH_SCOPES.join(' '),
  access_type: 'offline',
  state: state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}
