import { z } from 'zod';

import { FacebookAdapter, FacebookPostResponse } from './facebook/FacebookAdapter';
import { GaAdapter, GACredentials, GARequest, GAResponse } from './ga/GaAdapter';
import { GscAdapter, GSCAuth, SearchAnalyticsRequest, SearchAnalyticsResponse } from './gsc/GscAdapter';
import { timeoutConfig } from '@config';
import { VaultClient } from '../services/vault/VaultClient';
import { VercelAdapter, VercelDeployPayload, VercelDeployResponse } from './vercel/VercelAdapter';
import { withTimeout, withCircuitBreaker } from '../utils/resilience';
import {
  validateGACreds,
  validateGSCCreds,
  validateFacebookCreds,
  validateVercelCreds,
} from '../utils/validation';

/**
 * Type-safe wrapper for withCircuitBreaker that preserves function signatures.
 * Avoids the unsafe double cast through `(...args: unknown[]) => Promise<unknown>`.
 */
function wrapWithCircuitBreakerAndTimeout<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  timeoutMs: number,
  threshold: number,
  name: string,
): (...args: TArgs) => Promise<TResult> {
  const wrapped = withCircuitBreaker(
    ((...args: unknown[]) => withTimeout(fn(...(args as TArgs)), timeoutMs)) as (...args: unknown[]) => Promise<unknown>,
    threshold,
    name,
  );
  return (...args: TArgs) => wrapped(...args) as Promise<TResult>;
}

const GA_TIMEOUT = timeoutConfig.short;
const GSC_TIMEOUT = timeoutConfig.short;
const FACEBOOK_TIMEOUT = timeoutConfig.short;
const VERCEL_TIMEOUT = timeoutConfig.medium;

const GSCAuthSchema = z.object({
  client_email: z.string().optional(),
  private_key: z.string().optional(),
  client_id: z.string().optional(),
});

function validateGSCAuth(creds: unknown): GSCAuth {
  const result = GSCAuthSchema.safeParse(creds);
  if (!result.success) {
    throw new Error(`Invalid GSC auth credentials: ${result.error.message}`);
  }
  return result.data as GSCAuth;
}

export interface GACreds extends GACredentials {
  client_email: string;
  private_key: string;
}

export interface GSCCreds {
  client_email?: string;
  private_key?: string;
  client_id?: string;
}

export interface FacebookCreds {
  accessToken: string;
}

export interface VercelCreds {
  token: string;
}

export type GaRequest = Parameters<GaAdapter['fetchMetrics']>;
export type GscRequest = Parameters<GscAdapter['fetchSearchAnalytics']>;
export type FacebookRequest = Parameters<FacebookAdapter['publishPagePost']>;
export type VercelRequest = Parameters<VercelAdapter['triggerDeploy']>;

/**
 * P1-4 FIX: Module-level registry to share circuit breaker state across adapter instances.
 * Keyed by service name so all instances of the same adapter type share one circuit breaker.
 */
const circuitBreakerRegistry = new Map<string, (...args: unknown[]) => Promise<unknown>>();

function getOrCreateCircuitBreaker<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  timeoutMs: number,
  threshold: number,
  name: string,
): (...args: TArgs) => Promise<TResult> {
  const existing = circuitBreakerRegistry.get(name);
  if (existing) {
    return (...args: TArgs) => existing(...args) as Promise<TResult>;
  }
  const wrapped = wrapWithCircuitBreakerAndTimeout(fn, timeoutMs, threshold, name);
  circuitBreakerRegistry.set(name, wrapped as (...args: unknown[]) => Promise<unknown>);
  return wrapped;
}

export class AdapterFactory {
  constructor(private readonly vault: VaultClient) {}

  async ga(orgId: string): Promise<GaAdapter> {
    const secret = await this.vault.getSecret(orgId, 'ga');
    const creds = validateGACreds(secret);

    const adapter = new GaAdapter(creds);
    const originalFetchMetrics = adapter.fetchMetrics.bind(adapter);
    adapter.fetchMetrics = getOrCreateCircuitBreaker(
      originalFetchMetrics, GA_TIMEOUT, 3, 'ga'
    );
    return adapter;
  }

  async gsc(orgId: string): Promise<GscAdapter> {
    const secret = await this.vault.getSecret(orgId, 'gsc');
    const creds = validateGSCCreds(secret);

    const auth = validateGSCAuth(creds);

    const adapter = new GscAdapter(auth);
    const originalFetchSearchAnalytics = adapter.fetchSearchAnalytics.bind(adapter);
    adapter.fetchSearchAnalytics = getOrCreateCircuitBreaker(
      originalFetchSearchAnalytics, GSC_TIMEOUT, 3, 'gsc'
    );
    return adapter;
  }

  async facebook(orgId: string): Promise<FacebookAdapter> {
    const secret = await this.vault.getSecret(orgId, 'facebook');
    const tokenData = validateFacebookCreds(secret);

    const adapter = new FacebookAdapter(tokenData.accessToken);
    const originalPublishPagePost = adapter.publishPagePost.bind(adapter);
    adapter.publishPagePost = getOrCreateCircuitBreaker(
      originalPublishPagePost, FACEBOOK_TIMEOUT, 3, 'facebook'
    );
    return adapter;
  }

  async vercel(orgId: string): Promise<VercelAdapter> {
    const secret = await this.vault.getSecret(orgId, 'vercel');
    const tokenData = validateVercelCreds(secret);

    const adapter = new VercelAdapter(tokenData.token);
    const originalTriggerDeploy = adapter.triggerDeploy.bind(adapter);
    adapter.triggerDeploy = getOrCreateCircuitBreaker(
      originalTriggerDeploy, VERCEL_TIMEOUT, 3, 'vercel'
    );
    return adapter;
  }
}
