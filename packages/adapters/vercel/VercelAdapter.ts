import fetch from 'node-fetch';

import { API_VERSIONS, DEFAULT_TIMEOUTS } from '@config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';
import { validateNonEmptyString } from '@kernel/validation';
import { withRetry } from '@kernel/retry';


/**
* Vercel Deployment Adapter
*
*/

/**
* API Error with status code and retry information
*/
class ApiError extends Error {
  constructor(
  message: string,
  public status: number,
  public retryAfter?: string
  ) {
  super(message);
  this.name = 'ApiError';
  }
}

// Type definitions
export interface VercelDeployPayload {
  name?: string;
  gitSource?: {
  type: 'github' | 'gitlab' | 'bitbucket';
  ref: string;
  repoId: string | number;
  };
  source?: 'git' | 'cli';
  target?: 'production' | 'staging';
  meta?: Record<string, string>;
}

export interface VercelDeployResponse {
  id: string;
  url: string;
  state?: 'BUILDING' | 'ERROR' | 'INITIALIZING' | 'QUEUED' | 'READY' | 'CANCELED';
  createdAt?: number;
  creator?: {
  uid: string;
  email?: string;
  username?: string;
  githubLogin?: string;
  };
}

export class VercelAdapter {
  private readonly baseUrl: string;
  private readonly timeoutMs = DEFAULT_TIMEOUTS.long;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(private readonly token: string) {
  validateNonEmptyString(token, 'token');

  this.baseUrl = `https://api.vercel.com/${API_VERSIONS.vercel}`;
  this.logger = new StructuredLogger('VercelAdapter');
  this.metrics = new MetricsCollector('VercelAdapter');
  }

  /**
  * Trigger a deployment on Vercel
  * @param projectId - The Vercel project ID
  * @param payload - Deployment configuration payload
  * @returns Deployment response with ID and URL
  * @throws Error if deployment fails or input is invalid
  */
  async triggerDeploy(projectId: string, payload: VercelDeployPayload): Promise<VercelDeployResponse> {
  const context = createRequestContext('VercelAdapter', 'triggerDeploy');

  validateNonEmptyString(projectId, 'projectId');

  this.logger.info('Triggering Vercel deployment', context, { projectId, target: payload.target });

  const startTime = Date.now();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

  try {
    const res = await withRetry(async () => {
    const response = await fetch(
    `${this.baseUrl}/deployments?projectId=${encodeURIComponent(projectId)}`,
    {
    method: 'POST',
    headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: controller.signal,
    }
    );

    if (!response.ok) {
    const _errorBody = await response.text();

    if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') || undefined;
    throw new ApiError(`Vercel rate limited: ${response.status}`, response.status, retryAfter);
    }

    throw new Error(`Vercel deploy failed: ${response.status} ${response.statusText}`);
    }

    return response;
    }, { maxRetries: 3 });

    const rawData = await res.json();
    if (!rawData || typeof rawData !== 'object' || typeof (rawData as { id?: unknown }).id !== 'string') {
    throw new ApiError('Invalid response format from Vercel API', 500);
    }
    const data = rawData as VercelDeployResponse;

    const latency = Date.now() - startTime;
    this.metrics.recordLatency('triggerDeploy', latency, true);
    this.metrics.recordSuccess('triggerDeploy');
    this.logger.info('Successfully triggered Vercel deployment', context, {
    deploymentId: data.id,
    url: data["url"]
    });

    return data;
  } catch (error) {
    const latency = Date.now() - startTime;
    this.metrics.recordLatency('triggerDeploy', latency, false);
    this.metrics.recordError('triggerDeploy', error instanceof Error ? error.name : 'Unknown');
    this.logger.error('Failed to trigger Vercel deployment', context, error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  }

  /**
  * Get deployment status from Vercel
  * @param deploymentId - The deployment ID to check
  * @returns Deployment status and details
  * @throws Error if deployment not found or request fails
  */
  async getDeployment(deploymentId: string): Promise<VercelDeployResponse> {
  const context = createRequestContext('VercelAdapter', 'getDeployment');

  validateNonEmptyString(deploymentId, 'deploymentId');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.medium);

  try {
    const res = await withRetry(async () => {
    const response = await fetch(`${this.baseUrl}/deployments/${deploymentId}`, {
    method: 'GET',
    headers: {
    'Authorization': `Bearer ${this.token}`,
    'Accept': 'application/json',
    },
    signal: controller.signal,
    });

    if (!response.ok) {
    if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') || undefined;
    throw new ApiError(`Vercel rate limited: ${response.status}`, response.status, retryAfter);
    }

    throw new ApiError(`Vercel get deployment failed: ${response.status}`, response.status);
    }

    return response;
    }, { maxRetries: 3 });

    const rawData = await res.json();
    if (!rawData || typeof rawData !== 'object' || typeof (rawData as { id?: unknown }).id !== 'string') {
    throw new ApiError('Invalid response format from Vercel API', 500);
    }
    const data = rawData as VercelDeployResponse;

    this.metrics.recordSuccess('getDeployment');

    return data;
  } catch (error) {
    this.metrics.recordError('getDeployment', error instanceof Error ? error.name : 'Unknown');
    this.logger.error('Failed to get Vercel deployment', context, error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  }

  /**
  * Cancel a deployment on Vercel
  * @param deploymentId - The deployment ID to cancel
  * @throws Error if cancellation fails
  */
  async cancelDeployment(deploymentId: string): Promise<void> {
  const context = createRequestContext('VercelAdapter', 'cancelDeployment');

  validateNonEmptyString(deploymentId, 'deploymentId');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.medium);

  try {
    const _res = await withRetry(async () => {
    const response = await fetch(`${this.baseUrl}/deployments/${deploymentId}/cancel`, {
    method: 'PATCH',
    headers: {
    'Authorization': `Bearer ${this.token}`,
    'Accept': 'application/json',
    },
    signal: controller.signal,
    });

    if (!response.ok && response.status !== 409) { // 409 = already in terminal state
    if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after') || undefined;
    throw new ApiError(`Vercel rate limited: ${response.status}`, response.status, retryAfter);
    }

    throw new ApiError(`Vercel cancel deployment failed: ${response.status}`, response.status);
    }

    return response;
    }, { maxRetries: 3 });

    this.metrics.recordSuccess('cancelDeployment');
  } catch (error) {
    this.metrics.recordError('cancelDeployment', error instanceof Error ? error.name : 'Unknown');
    this.logger.error('Failed to cancel Vercel deployment', context, error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
  }

  /**
  * Health check for Vercel API connection
  * @returns Health status with latency and optional error message
  */
  async healthCheck(): Promise<{ healthy: boolean; latency: number; error?: string | undefined }> {
  const start = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUTS.short);

  try {
    // Check user info as health check
    const res = await fetch(`${this.baseUrl}/user`, {
    method: 'GET',
    headers: {
    'Authorization': `Bearer ${this.token}`,
    'Accept': 'application/json',
    },
    signal: controller.signal,
    });

    const latency = Date.now() - start;

    // Only 200-299 status codes indicate a healthy service
    const healthy = res.ok;

    return {
    healthy,
    latency,
    error: healthy ? undefined : `Vercel API returned status ${res.status}`,
    };
  } catch (error) {
    return {
    healthy: false,
    latency: Date.now() - start,
    error: error instanceof Error ? error["message"] : 'Unknown error',
    };
  } finally {
    clearTimeout(timeoutId);
  }
  }
}
