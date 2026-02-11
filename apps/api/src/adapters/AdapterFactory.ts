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

export class AdapterFactory {
  constructor(private readonly vault: VaultClient) {}

  async ga(orgId: string): Promise<GaAdapter> {
    const secret = await this.vault.getSecret(orgId, 'ga');
    const creds = validateGACreds(secret);

    const adapter = new GaAdapter(creds);
    const originalFetchMetrics = adapter.fetchMetrics.bind(adapter);
    adapter.fetchMetrics = withCircuitBreaker(
      ((propertyId: string, request: GARequest) => withTimeout(originalFetchMetrics(propertyId, request), GA_TIMEOUT)) as (...args: unknown[]) => Promise<unknown>,
      3,
      'ga'
    ) as (propertyId: string, request: GARequest) => Promise<GAResponse>;
    return adapter;
  }

  async gsc(orgId: string): Promise<GscAdapter> {
    const secret = await this.vault.getSecret(orgId, 'gsc');
    const creds = validateGSCCreds(secret);

    const auth = validateGSCAuth(creds);

    const adapter = new GscAdapter(auth);
    const originalFetchSearchAnalytics = adapter.fetchSearchAnalytics.bind(adapter);
    adapter.fetchSearchAnalytics = withCircuitBreaker(
      ((siteUrl: string, body: SearchAnalyticsRequest) => withTimeout(originalFetchSearchAnalytics(siteUrl, body), GSC_TIMEOUT)) as (...args: unknown[]) => Promise<unknown>,
      3,
      'gsc'
    ) as (siteUrl: string, body: SearchAnalyticsRequest) => Promise<SearchAnalyticsResponse>;
    return adapter;
  }

  async facebook(orgId: string): Promise<FacebookAdapter> {
    const secret = await this.vault.getSecret(orgId, 'facebook');
    const tokenData = validateFacebookCreds(secret);

    const adapter = new FacebookAdapter(tokenData.accessToken);
    const originalPublishPagePost = adapter.publishPagePost.bind(adapter);
    adapter.publishPagePost = withCircuitBreaker(
      ((pageId: string, message: string) => withTimeout(originalPublishPagePost(pageId, message), FACEBOOK_TIMEOUT)) as (...args: unknown[]) => Promise<unknown>,
      3,
      'facebook'
    ) as (pageId: string, message: string) => Promise<FacebookPostResponse>;
    return adapter;
  }

  async vercel(orgId: string): Promise<VercelAdapter> {
    const secret = await this.vault.getSecret(orgId, 'vercel');
    const tokenData = validateVercelCreds(secret);

    const adapter = new VercelAdapter(tokenData.token);
    const originalTriggerDeploy = adapter.triggerDeploy.bind(adapter);
    adapter.triggerDeploy = withCircuitBreaker(
      ((projectId: string, payload: VercelDeployPayload) => withTimeout(originalTriggerDeploy(projectId, payload), VERCEL_TIMEOUT)) as (...args: unknown[]) => Promise<unknown>,
      3,
      'vercel'
    ) as (projectId: string, payload: VercelDeployPayload) => Promise<VercelDeployResponse>;
    return adapter;
  }
}
