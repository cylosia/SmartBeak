
import fetch from 'node-fetch';

const VERCEL_API = 'https://api.vercel.com';

function getVercelToken(): string {
  const token = process.env['VERCEL_TOKEN'];
  if (!token) {
  throw new Error('VERCEL_TOKEN environment variable is required');
  }
  // Validate token format (should be a non-empty string)
  if (typeof token !== 'string' || token.length < 10) {
  throw new Error('VERCEL_TOKEN appears to be invalid (too short or not a string)');
  }
  return token;
}

export interface VercelProvisionInput {
  teamId?: string;
  projectName: string;
  gitRepo?: string;
  env: Record<string, string>;
}

export interface VercelProjectResponse {
  id: string;
  name: string;
  accountId: string;
  createdAt: number;
}

export async function provisionVercelProject(
  input: VercelProvisionInput
): Promise<VercelProjectResponse> {
  const token = getVercelToken();

  const res = await fetch(`${VERCEL_API}/v9/projects`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    name: input.projectName,
    gitRepository: input.gitRepo ? { repo: input.gitRepo } : undefined,
    environmentVariables: Object.entries(input.env).map(([key, value]) => ({
    key, value, target: ['production']
    }))
  })
  });

  if (!res.ok) {
  const text = await res.text();
  throw new Error(`Vercel provisioning failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<VercelProjectResponse>;
}

export interface DomainAttachResponse {
  name: string;
  projectId: string;
}

export async function attachDomain(
  projectId: string,
  domain: string
): Promise<DomainAttachResponse> {
  const token = getVercelToken();

  const res = await fetch(`${VERCEL_API}/v9/projects/${projectId}/domains`, {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ name: domain })
  });

  if (!res.ok) {
  const text = await res.text();
  throw new Error(`Domain attach failed: ${res.status} ${text}`);
  }

  return res.json() as Promise<DomainAttachResponse>;
}
