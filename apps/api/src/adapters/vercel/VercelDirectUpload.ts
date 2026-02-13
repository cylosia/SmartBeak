/**
 * Vercel Direct File Upload Adapter
 * 
 * Implements Vercel's API for deploying files directly without Git.
 * This is used for the shard deployment architecture where each site
 * gets its own Vercel project with custom generated code.
 */

import fetch from 'node-fetch';
import { createHash } from 'crypto';
import { API_VERSIONS } from '@config';
import { StructuredLogger, createRequestContext, MetricsCollector } from '@kernel/request';
import { validateNonEmptyString } from '../../utils/validation';
import { withRetry } from '../../utils/retry';

/**
 * File to be deployed to Vercel
 */
export interface VercelDeployFile {
  file: string;           // File path (e.g., "pages/index.tsx")
  data?: string;          // Base64 encoded content (optional if using sha)
  encoding?: 'base64';    // Encoding type
  sha?: string;           // SHA1 hash of file content
  size?: number;          // File size in bytes
}

/**
 * Direct upload deployment payload
 */
export interface VercelDirectDeployPayload {
  files: VercelDeployFile[];           // Array of files to deploy
  name?: string | undefined;                       // Deployment name
  target?: 'production' | 'staging' | undefined;   // Deployment target
  projectId?: string | undefined;                  // Vercel project ID (required)
  meta?: Record<string, string> | undefined;       // Metadata
  env?: Record<string, string> | undefined;        // Environment variables
  build?: {
    env?: Record<string, string> | undefined;      // Build-time env vars
  } | undefined;
  framework?: string | undefined;                  // Framework preset (e.g., "nextjs")
}

/**
 * Vercel deployment response
 */
export interface VercelDirectDeployResponse {
  id: string;
  url: string;
  name: string;
  meta: Record<string, string>;
  version: number;
  type: 'LAMBDAS';
  state: 'BUILDING' | 'ERROR' | 'INITIALIZING' | 'QUEUED' | 'READY' | 'CANCELED';
  readyState: 'BUILDING' | 'ERROR' | 'INITIALIZING' | 'QUEUED' | 'READY' | 'CANCELED';
  ready: number;
  createdAt: number;
  creator: {
    uid: string;
    email?: string;
    username?: string;
    githubLogin?: string;
  };
  inspectorUrl: string;
  projectId?: string;
  projectName?: string;
}

/**
 * Response from checking which files Vercel already has
 */
export interface VercelFileCheckResponse {
  missing: string[];  // Array of SHA hashes Vercel doesn't have
}

/**
 * API Error with status code
 */
class VercelApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public response?: unknown
  ) {
    super(message);
    this.name = 'VercelApiError';
  }
}

/**
 * Vercel Direct Upload Adapter
 * 
 * Handles the complete flow:
 * 1. Calculate SHA hashes for all files
 * 2. Check which files Vercel already has
 * 3. Upload missing files
 * 4. Create deployment
 */
export class VercelDirectUploadAdapter {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly logger: StructuredLogger;
  private readonly metrics: MetricsCollector;

  constructor(token: string) {
    validateNonEmptyString(token, 'token');
    this.token = token;
    this.baseUrl = `https://api.vercel.com/${API_VERSIONS.vercel}`;
    this.logger = new StructuredLogger('VercelDirectUpload');
    this.metrics = new MetricsCollector('VercelDirectUpload');
  }

  /**
   * Calculate SHA1 hash of file content (required by Vercel API)
   */
  private calculateSha1(content: string): string {
    return createHash('sha1').update(content).digest('hex');
  }

  /**
   * Prepare files with SHA hashes
   */
  private prepareFiles(files: Array<{ path: string; content: string }>): VercelDeployFile[] {
    return files.map(file => {
      const sha = this.calculateSha1(file.content);
      const size = Buffer.byteLength(file.content, 'utf8');
      
      return {
        file: file.path,
        sha,
        size,
        // Don't include data here - we'll upload separately if needed
      };
    });
  }

  /**
   * Check which files Vercel already has
   * @returns Array of SHA hashes that need to be uploaded
   */
  private async checkMissingFiles(
    files: VercelDeployFile[],
    teamId?: string
  ): Promise<string[]> {
    const context = createRequestContext('VercelDirectUpload', 'checkMissingFiles');
    
    const shaList = files
      .filter(f => f.sha)
      .map(f => f.sha!);
    
    if (shaList.length === 0) {
      return [];
    }

    try {
      this.logger.info('Checking for missing files', context, { fileCount: shaList.length });

      const url = new URL(`${this.baseUrl}/files`);
      if (teamId) {
        url.searchParams.append('teamId', teamId);
      }

      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          files: shaList,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new VercelApiError(
          `Failed to check missing files: ${response.status} ${errorText}`,
          response.status
        );
      }

      const result = await response.json() as VercelFileCheckResponse;
      this.logger.info('File check complete', context, { 
        total: shaList.length, 
        missing: result.missing.length 
      });

      return result.missing;
    } catch (error) {
      this.logger.error('Failed to check missing files', context, error as Error);
      throw error;
    }
  }

  /**
   * Upload a single file to Vercel's file storage
   */
  private async uploadFile(
    sha: string,
    content: string,
    teamId?: string
  ): Promise<void> {
    const _context = createRequestContext('VercelDirectUpload', 'uploadFile');

    try {
      const url = new URL(`${this.baseUrl}/files`);
      if (teamId) {
        url.searchParams.append('teamId', teamId);
      }

      // Upload file content
      const response = await fetch(url.toString(), {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/octet-stream',
          'x-vercel-digest': sha,
          'Content-Length': Buffer.byteLength(content, 'utf8').toString(),
        },
        body: content,
      });

      if (!response.ok && response.status !== 409) { // 409 = file already exists
        const errorText = await response.text();
        throw new VercelApiError(
          `Failed to upload file: ${response.status} ${errorText}`,
          response.status
        );
      }

      this.metrics.recordSuccess('uploadFile');
    } catch (error) {
      this.metrics.recordError('uploadFile', error instanceof Error ? error.name : 'Unknown');
      throw error;
    }
  }

  /**
   * Upload all missing files to Vercel
   */
  private async uploadMissingFiles(
    files: Array<{ path: string; content: string; sha: string }>,
    missingShas: string[],
    teamId?: string
  ): Promise<void> {
    const context = createRequestContext('VercelDirectUpload', 'uploadMissingFiles');
    
    const missingFiles = files.filter(f => missingShas.includes(f.sha));
    
    if (missingFiles.length === 0) {
      this.logger.info('All files already exist on Vercel', context);
      return;
    }

    this.logger.info('Uploading missing files', context, { count: missingFiles.length });

    // Upload files in parallel with concurrency limit
    const CONCURRENCY = 10;
    for (let i = 0; i < missingFiles.length; i += CONCURRENCY) {
      const batch = missingFiles.slice(i, i + CONCURRENCY);
      await Promise.all(
        batch.map(file => this.uploadFile(file.sha, file.content, teamId))
      );
      
      this.logger.info('Upload batch complete', context, { 
        batch: Math.floor(i / CONCURRENCY) + 1,
        total: Math.ceil(missingFiles.length / CONCURRENCY)
      });
    }
  }

  /**
   * Create the deployment after files are uploaded
   */
  private async createDeployment(
    payload: VercelDirectDeployPayload,
    teamId?: string
  ): Promise<VercelDirectDeployResponse> {
    const context = createRequestContext('VercelDirectUpload', 'createDeployment');
    const startTime = Date.now();

    try {
      this.logger.info('Creating deployment', context, {
        projectId: payload.projectId,
        target: payload.target,
        fileCount: payload.files.length,
      });

      const url = new URL(`${this.baseUrl}/deployments`);
      if (teamId) {
        url.searchParams.append('teamId', teamId);
      }
      if (payload.projectId) {
        url.searchParams.append('projectId', payload.projectId);
      }

      // Build deployment body
      const body: Record<string, unknown> = {
        name: payload.name || `deployment-${Date.now()}`,
        files: payload.files.map(f => ({
          file: f.file,
          sha: f.sha,
          size: f.size,
        })),
        target: payload.target || 'production',
        meta: payload.meta || {},
        framework: payload.framework || 'nextjs',
      };

      if (payload.env) {
        body['env'] = payload.env;
      }
      if (payload.build?.env) {
        body['build'] = { env: payload.build.env };
      }

      const response = await withRetry(async () => {
        const res = await fetch(url.toString(), {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${this.token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const errorText = await res.text();
          throw new VercelApiError(
            `Deployment creation failed: ${res.status} ${errorText}`,
            res.status
          );
        }

        return res;
      }, { maxRetries: 3 });

      const deployment = await response.json() as VercelDirectDeployResponse;
      
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('createDeployment', latency, true);
      this.metrics.recordSuccess('createDeployment');

      this.logger.info('Deployment created successfully', context, {
        deploymentId: deployment.id,
        url: deployment.url,
        state: deployment.state,
      });

      return deployment;
    } catch (error) {
      const latency = Date.now() - startTime;
      this.metrics.recordLatency('createDeployment', latency, false);
      this.metrics.recordError('createDeployment', error instanceof Error ? error.name : 'Unknown');
      this.logger.error('Failed to create deployment', context, error as Error);
      throw error;
    }
  }

  /**
   * Main method: Deploy files directly to Vercel
   * 
   * This is the complete flow:
   * 1. Calculate SHA hashes for all files
   * 2. Check which files Vercel already has
   * 3. Upload missing files
   * 4. Create deployment
   * 
   * @param files - Array of {path, content} objects
   * @param options - Deployment options
   * @returns Deployment response
   */
  async deployFiles(
    files: Array<{ path: string; content: string }>,
    options: {
      projectId: string;
      teamId?: string;
      target?: 'production' | 'staging';
      name?: string;
      meta?: Record<string, string>;
      env?: Record<string, string>;
      framework?: string;
    }
  ): Promise<VercelDirectDeployResponse> {
    const context = createRequestContext('VercelDirectUpload', 'deployFiles');
    const startTime = Date.now();

    try {
      validateNonEmptyString(options.projectId, 'projectId');

      if (!files.length) {
        throw new Error('No files provided for deployment');
      }

      this.logger.info('Starting direct file deployment', context, {
        fileCount: files.length,
        projectId: options.projectId,
        totalSize: files.reduce((sum, f) => sum + Buffer.byteLength(f.content, 'utf8'), 0),
      });

      // Step 1: Calculate SHA hashes for all files
      const preparedFiles = this.prepareFiles(files);
      const _shaToContent = new Map(
        files.map(f => [this.calculateSha1(f.content), f.content])
      );

      // Step 2: Check which files Vercel already has
      const missingShas = await this.checkMissingFiles(preparedFiles, options.teamId);

      // Step 3: Upload missing files
      if (missingShas.length > 0) {
        const filesWithSha = files.map(f => ({
          path: f.path,
          content: f.content,
          sha: this.calculateSha1(f.content),
        }));
        await this.uploadMissingFiles(filesWithSha, missingShas, options.teamId);
      }

      // Step 4: Create deployment
      const deployment = await this.createDeployment({
        files: preparedFiles,
        projectId: options.projectId,
        target: options.target || 'production',
        ...(options.name !== undefined ? { name: options.name } : {}),
        meta: options.meta,
        env: options.env,
        framework: options.framework || 'nextjs',
      }, options.teamId);

      const totalLatency = Date.now() - startTime;
      this.logger.info('Deployment complete', context, {
        deploymentId: deployment.id,
        url: deployment.url,
        totalTimeMs: totalLatency,
      });

      return deployment;
    } catch (error) {
      this.logger.error('Deployment failed', context, error as Error);
      throw error;
    }
  }

  /**
   * Get deployment status
   */
  async getDeploymentStatus(
    deploymentId: string,
    teamId?: string
  ): Promise<VercelDirectDeployResponse> {
    const context = createRequestContext('VercelDirectUpload', 'getDeploymentStatus');

    try {
      const url = new URL(`${this.baseUrl}/deployments/${deploymentId}`);
      if (teamId) {
        url.searchParams.append('teamId', teamId);
      }

      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new VercelApiError(
          `Failed to get deployment status: ${response.status} ${errorText}`,
          response.status
        );
      }

      return await response.json() as VercelDirectDeployResponse;
    } catch (error) {
      this.logger.error('Failed to get deployment status', context, error as Error);
      throw error;
    }
  }

  /**
   * Wait for deployment to be ready
   */
  async waitForDeployment(
    deploymentId: string,
    options: {
      teamId?: string;
      timeoutMs?: number;
      pollIntervalMs?: number;
    } = {}
  ): Promise<VercelDirectDeployResponse> {
    const { teamId, timeoutMs = 300000, pollIntervalMs = 5000 } = options;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      const deployment = await this.getDeploymentStatus(deploymentId, teamId);

      if (deployment.state === 'READY') {
        return deployment;
      }

      if (deployment.state === 'ERROR' || deployment.state === 'CANCELED') {
        throw new Error(`Deployment failed with state: ${deployment.state}`);
      }

      // Wait before polling again
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }

    throw new Error(`Deployment timeout after ${timeoutMs}ms`);
  }
}

export default VercelDirectUploadAdapter;
