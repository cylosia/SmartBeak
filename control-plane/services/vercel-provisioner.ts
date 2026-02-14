import fetch, { type Response } from 'node-fetch';
import { z } from 'zod';
import { getLogger } from '../../packages/kernel/logger';
import { API_BASE_URLS } from '@config';

const logger = getLogger('VercelProvisioner');

const VERCEL_API = API_BASE_URLS.vercel;

// P1-7 FIX: Timeout for external HTTP requests (30 seconds)
const FETCH_TIMEOUT_MS = 30000;

// P1-4 FIX: Strict format validation for Vercel project IDs
const PROJECT_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

// P1-8 FIX: Allowlist of environment variable keys safe to forward to Vercel
const ALLOWED_ENV_KEYS = new Set([
  'NEXT_PUBLIC_APP_URL',
  'NEXT_PUBLIC_ACP_API',
  'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_ANALYTICS_ID',
  'NEXT_PUBLIC_SITE_ID',
]);

function getVercelToken(): string {
  const token = process.env['VERCEL_TOKEN'];
  if (!token) {
    throw new Error('VERCEL_TOKEN environment variable is required');
  }
  if (typeof token !== 'string' || token.length < 10) {
    throw new Error('VERCEL_TOKEN appears to be invalid (too short or not a string)');
  }
  return token;
}

// P1-4 FIX: Validate identifiers before URL interpolation to prevent path traversal SSRF
function validateProjectId(projectId: string): void {
  if (!projectId || !PROJECT_ID_REGEX.test(projectId)) {
    throw new Error('Invalid Vercel project ID format');
  }
}

// P1-6 FIX: Zod schemas for runtime validation of API responses
const VercelProjectResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  accountId: z.string(),
  createdAt: z.number(),
});

const DomainAttachResponseSchema = z.object({
  name: z.string(),
  projectId: z.string(),
});

export interface VercelProvisionInput {
  teamId?: string;
  projectName: string;
  gitRepo?: string;
  env: Record<string, string>;
}

export type VercelProjectResponse = z.infer<typeof VercelProjectResponseSchema>;

export type DomainAttachResponse = z.infer<typeof DomainAttachResponseSchema>;

// P1-7 FIX: Helper to create a fetch request with timeout via AbortController
async function fetchWithTimeout(url: string, options: Parameters<typeof fetch>[1]): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal as Parameters<typeof fetch>[1] extends { signal?: infer S } ? S : never,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function provisionVercelProject(
  input: VercelProvisionInput
): Promise<VercelProjectResponse> {
  const token = getVercelToken();

  // P1-8 FIX: Filter env vars against allowlist before forwarding to Vercel
  const filteredEnv = Object.entries(input.env).filter(([key]) => ALLOWED_ENV_KEYS.has(key));

  const res = await fetchWithTimeout(`${VERCEL_API}/v9/projects`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: input.projectName,
      gitRepository: input.gitRepo ? { repo: input.gitRepo } : undefined,
      environmentVariables: filteredEnv.map(([key, value]) => ({
        key, value, target: ['production']
      }))
    })
  });

  if (!res.ok) {
    // P1-5 FIX: Log full error internally but throw sanitized error message
    const text = await res.text();
    logger.error('Vercel provisioning failed', undefined, { status: res.status, response: text });
    throw new Error(`Vercel provisioning failed with status ${res.status}`);
  }

  // P1-6 FIX: Parse response through Zod schema instead of unsafe type assertion
  const data = await res.json();
  return VercelProjectResponseSchema.parse(data);
}

export async function attachDomain(
  projectId: string,
  domain: string
): Promise<DomainAttachResponse> {
  // P1-4 FIX: Validate projectId before interpolating into URL
  validateProjectId(projectId);

  const token = getVercelToken();

  const res = await fetchWithTimeout(`${VERCEL_API}/v9/projects/${projectId}/domains`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ name: domain })
  });

  if (!res.ok) {
    // P1-5 FIX: Log full error internally but throw sanitized error message
    const text = await res.text();
    logger.error('Domain attach failed', undefined, { status: res.status, projectId, response: text });
    throw new Error(`Domain attach failed with status ${res.status}`);
  }

  // P1-6 FIX: Parse response through Zod schema instead of unsafe type assertion
  const data = await res.json();
  return DomainAttachResponseSchema.parse(data);
}
