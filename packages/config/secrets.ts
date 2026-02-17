/**
 * Secrets Management
 *
 * Structured manifest documenting every secret category with:
 * - Which env vars are needed
 * - Whether they're required or optional
 * - How to generate them
 * - How to rotate them
 *
 * @module @config/secrets
 */

export interface SecretCategory {
  readonly vars: readonly string[];
  readonly required: boolean;
  readonly description: string;
  readonly rotation: string;
  readonly generation: string;
}

export const SECRET_MANIFEST = {
  core: {
    vars: ['CONTROL_PLANE_DB', 'JWT_KEY_1', 'JWT_KEY_2', 'KEY_ENCRYPTION_SECRET'],
    required: true,
    description: 'Core platform secrets for database access, JWT signing, and encryption.',
    rotation: 'Rotate JWT keys in pairs. Deploy JWT_KEY_2 first (used for verification), then update JWT_KEY_1 (used for signing). KEY_ENCRYPTION_SECRET requires re-encrypting all stored secrets before rotating.',
    generation: 'Use: openssl rand -base64 48',
  },
  auth: {
    vars: ['CLERK_SECRET_KEY', 'CLERK_WEBHOOK_SECRET'],
    required: true,
    description: 'Clerk authentication service credentials.',
    rotation: 'Rotate via Clerk dashboard. Update CLERK_WEBHOOK_SECRET in Clerk + env simultaneously to avoid missed webhooks.',
    generation: 'Provisioned by Clerk dashboard — do not generate manually.',
  },
  payments: {
    vars: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET', 'PADDLE_API_KEY', 'PADDLE_WEBHOOK_SECRET'],
    required: true,
    description: 'Payment processor credentials for Stripe and Paddle.',
    rotation: 'For Stripe: create a new webhook endpoint, update the secret, then delete the old endpoint. For Paddle: regenerate in Paddle dashboard.',
    generation: 'Provisioned by Stripe/Paddle dashboards.',
  },
  email: {
    vars: ['SENDGRID_API_KEY', 'POSTMARK_SERVER_TOKEN', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'SMTP_PASS'],
    required: false,
    description: 'Email delivery provider credentials (choose one provider).',
    rotation: 'Generate a new API key in the provider dashboard, update env, verify delivery, then revoke the old key.',
    generation: 'Provisioned by SendGrid/Postmark/AWS IAM dashboards.',
  },
  social: {
    vars: ['LINKEDIN_CLIENT_ID', 'LINKEDIN_CLIENT_SECRET', 'GBP_CLIENT_ID', 'GBP_CLIENT_SECRET', 'TIKTOK_CLIENT_KEY', 'TIKTOK_CLIENT_SECRET'],
    required: false,
    description: 'OAuth credentials for social media publishing integrations.',
    rotation: 'Rotate via each platform developer console. Update client secret first, then re-authorize connected accounts.',
    generation: 'Provisioned by LinkedIn/Google/TikTok developer consoles.',
  },
  affiliate: {
    vars: ['AMAZON_ACCESS_KEY', 'AMAZON_SECRET_KEY', 'CJ_PERSONAL_TOKEN', 'IMPACT_ACCOUNT_SID', 'IMPACT_AUTH_TOKEN'],
    required: false,
    description: 'Affiliate network API credentials.',
    rotation: 'Generate new credentials in each affiliate network dashboard, update env, then revoke old credentials.',
    generation: 'Provisioned by Amazon Associates/CJ/Impact dashboards.',
  },
  search: {
    vars: ['GSC_CLIENT_ID', 'GSC_CLIENT_SECRET', 'AHREFS_API_TOKEN', 'SERP_API_KEY', 'DATAFORSEO_LOGIN', 'DATAFORSEO_PASSWORD'],
    required: false,
    description: 'SEO and keyword research API credentials.',
    rotation: 'Rotate API keys in each provider dashboard. GSC uses OAuth — rotate client secret and re-authorize.',
    generation: 'Provisioned by Google Cloud Console/Ahrefs/SerpApi/DataForSEO dashboards.',
  },
  ai: {
    vars: ['OPENAI_API_KEY', 'STABILITY_API_KEY'],
    required: false,
    description: 'AI service API keys for content generation and image creation.',
    rotation: 'Generate a new key in the provider dashboard, update env, then revoke the old key.',
    generation: 'Provisioned by OpenAI/Stability AI dashboards.',
  },
  storage: {
    vars: ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'GOOGLE_CLOUD_STORAGE_KEY'],
    required: false,
    description: 'Object storage credentials for file uploads.',
    rotation: 'Create new access key pair, update env, verify uploads, then delete old key pair.',
    generation: 'Provisioned by Cloudflare/AWS/GCP IAM consoles.',
  },
  monitoring: {
    vars: ['SLACK_WEBHOOK_URL', 'ALERT_WEBHOOK_URL'],
    required: false,
    description: 'Webhook URLs for monitoring alerts.',
    rotation: 'Create a new webhook URL, update env, then delete the old webhook.',
    generation: 'Create incoming webhook in Slack workspace settings or alerting platform.',
  },
  deployment: {
    vars: ['VERCEL_TOKEN', 'VERCEL_TEAM_ID'],
    required: false,
    description: 'Deployment platform credentials.',
    rotation: 'Generate a new token in Vercel dashboard, update env, then revoke old token.',
    generation: 'Provisioned by Vercel dashboard under Account Settings > Tokens.',
  },
} as const satisfies Record<string, SecretCategory>;

export type SecretCategoryName = keyof typeof SECRET_MANIFEST;

/**
 * Get all env var names for a given feature/category.
 */
export function getSecretsForFeature(feature: SecretCategoryName): readonly string[] {
  return SECRET_MANIFEST[feature].vars;
}

/**
 * Get all secret categories that are required.
 */
export function getRequiredSecretCategories(): SecretCategoryName[] {
  return (Object.entries(SECRET_MANIFEST) as [SecretCategoryName, SecretCategory][])
    .filter(([, cat]) => cat.required)
    .map(([name]) => name);
}

/**
 * Validate that a secret value meets minimum strength requirements.
 */
export function validateSecretStrength(
  name: string,
  value: string
): { valid: boolean; warning?: string } {
  if (!value || value.length < 8) {
    return { valid: false, warning: `${name} is too short (minimum 8 characters)` };
  }

  // Check for common weak patterns
  if (/^(.)\1+$/.test(value)) {
    return { valid: false, warning: `${name} contains a repeated character pattern` };
  }

  if (/(123|abc|password|secret|admin|test)/i.test(value)) {
    return { valid: false, warning: `${name} appears to use a common weak pattern` };
  }

  // Warn if entropy seems low (all same case, no digits, short)
  if (value.length < 16 && !/\d/.test(value)) {
    return { valid: true, warning: `${name} may have low entropy — consider using a longer, more random value` };
  }

  return { valid: true };
}
