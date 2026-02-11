/**
 * Adapter-specific validations
 */

import { z } from 'zod';

// Adapter credential validation schemas
const GACredsSchema = z.object({
  client_email: z.string().email(),
  private_key: z.string().min(1),
});

const GSCCredsSchema = z.object({
  client_email: z.string().email().optional(),
  private_key: z.string().min(1).optional(),
  client_id: z.string().optional(),
});

const FacebookCredsSchema = z.object({
  accessToken: z.string().min(1),
});

const VercelCredsSchema = z.object({
  token: z.string().min(1),
});

/**
 * Validate Google Analytics credentials
 */
export function validateGACreds(creds: unknown): { client_email: string; private_key: string } {
  return GACredsSchema.parse(creds);
}

/**
 * Validate Google Search Console credentials
 */
export function validateGSCCreds(creds: unknown): { client_email?: string | undefined; private_key?: string | undefined; client_id?: string | undefined } {
  return GSCCredsSchema.parse(creds);
}

/**
 * Validate Facebook credentials
 */
export function validateFacebookCreds(creds: unknown): { accessToken: string } {
  return FacebookCredsSchema.parse(creds);
}

/**
 * Validate Vercel credentials
 */
export function validateVercelCreds(creds: unknown): { token: string } {
  return VercelCredsSchema.parse(creds);
}
