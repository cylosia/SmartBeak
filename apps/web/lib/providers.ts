

// import { getOptionalEnv } from '@config';
const getOptionalEnv = (key: string): string | undefined => {
  return process.env[key];
};

/**
* Third-party provider configuration
* All sensitive values are server-side only
*/

/**
* Validate that a provider is configured
*/
function validateProvider(name: string, config: Record<string, string>): void {
  const missing = Object.entries(config)
  .filter(([_, value]) => !value || value.includes('placeholder'))
  .map(([key]) => key);

  if (missing.length > 0) {
  console.warn(
    `[providers] ${name} provider is not fully configured. Missing: ${missing.join(', ')}`
  );
  }
}

// Ahrefs SEO/Keyword research
const ahrefsToken = getOptionalEnv('AHREFS_API_TOKEN');
validateProvider('Ahrefs', { token: ahrefsToken || '' });

// Google Search Console
const gscClientId = getOptionalEnv('GSC_CLIENT_ID');
const gscClientSecret = getOptionalEnv('GSC_CLIENT_SECRET');
validateProvider('Google Search Console', {
  clientId: gscClientId || '',
  clientSecret: gscClientSecret || ''
});

// Vercel deployment
const vercelToken = getOptionalEnv('VERCEL_TOKEN');
validateProvider('Vercel', { token: vercelToken || '' });

/**
* Provider configuration exports
* Use these in API routes and adapters
*/
export const PROVIDERS = {
  ahrefs: {
  token: ahrefsToken || '',
  isConfigured: !!ahrefsToken && !ahrefsToken.includes('placeholder'),
  },
  gsc: {
  clientId: gscClientId || '',
  clientSecret: gscClientSecret || '',
  isConfigured: !!gscClientId && !gscClientId.includes('placeholder') &&
          !!gscClientSecret && !gscClientSecret.includes('placeholder'),
  },
  vercel: {
  token: vercelToken || '',
  isConfigured: !!vercelToken && !vercelToken.includes('placeholder'),
  },
} as const;

/**
* Type guard to check if a provider is configured
*/
export function isProviderConfigured(
  provider: keyof typeof PROVIDERS
): boolean {
  return PROVIDERS[provider].isConfigured;
}

/**
* Assert that a provider is configured, throwing if not
*/
export function requireProvider(provider: keyof typeof PROVIDERS): void {
  if (!isProviderConfigured(provider)) {
  throw new Error(
    `${provider} provider is not configured. ` +
    `Please set the required environment variables.`
  );
  }
}
