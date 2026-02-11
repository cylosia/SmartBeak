/**
 * Shard Deployment Service
 * Manages file storage and Vercel deployments for site shards
 */

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createHash } from 'crypto';
import { writeFile, mkdir, rm, readFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { knex } from '../../packages/database';
import { VercelAdapter } from '../../apps/api/src/adapters/vercel/VercelAdapter';

// Types
export interface ShardFile {
  path: string;
  content: string;
  sha1?: string;
  size?: number;
}

export interface ShardConfig {
  siteId: string;
  themeId: string;
  themeConfig: Record<string, unknown>;
  customFiles?: ShardFile[];
}

export interface DeploymentResult {
  success: boolean;
  deploymentId?: string;
  url?: string;
  error?: string;
}

// Storage client (R2 is S3-compatible)
const storage = new S3Client({
  region: 'auto',
  endpoint: process.env['R2_ENDPOINT'],
  credentials: {
    accessKeyId: process.env['R2_ACCESS_KEY_ID']!,
    secretAccessKey: process.env['R2_SECRET_ACCESS_KEY']!,
  },
});

const BUCKET_NAME = process.env['R2_BUCKET_NAME'] || 'smartbeak-shards';

/**
 * Calculate SHA1 hash of content (required by Vercel API)
 */
function calculateSha1(content: string): string {
  return createHash('sha1').update(content).digest('hex');
}

/**
 * Save shard files to object storage (R2/S3)
 */
export async function saveShardToStorage(
  siteId: string,
  version: number,
  files: ShardFile[]
): Promise<string> {
  const storagePath = `shards/${siteId}/v${version}`;
  
  // Upload each file to R2
  await Promise.all(
    files.map(async (file) => {
      const key = `${storagePath}/${file.path}`;
      await storage.send(
        new PutObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
          Body: file.content,
          ContentType: getContentType(file.path),
        })
      );
    })
  );
  
  return storagePath;
}

/**
 * Get content type based on file extension
 */
function getContentType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  const types: Record<string, string> = {
    tsx: 'application/typescript',
    ts: 'application/typescript',
    jsx: 'application/javascript',
    js: 'application/javascript',
    json: 'application/json',
    css: 'text/css',
    html: 'text/html',
    svg: 'image/svg+xml',
  };
  return types[ext || ''] || 'text/plain';
}

/**
 * Create a new shard version in database
 */
export async function createShardVersion(
  config: ShardConfig,
  files: ShardFile[]
): Promise<{ shardId: string; storagePath: string }> {
  const { siteId, themeId, themeConfig } = config;
  
  // Get next version number
  const lastVersion = await knex('site_shards')
    .where('site_id', siteId)
    .max('version as max')
    .first();
  const version = (lastVersion?.max || 0) + 1;
  
  // Save files to storage
  const storagePath = await saveShardToStorage(siteId, version, files);
  
  // Build file manifest with SHA hashes
  const fileManifest: Record<string, { sha: string; size: number }> = {};
  for (const file of files) {
    const sha = calculateSha1(file.content);
    fileManifest[file.path] = {
      sha,
      size: Buffer.byteLength(file.content, 'utf8'),
    };
  }
  
  // Insert into database
  const [shard] = await knex('site_shards')
    .insert({
      site_id: siteId,
      version,
      status: 'draft',
      storage_backend: 'r2',
      storage_path: storagePath,
      file_manifest: JSON.stringify(fileManifest),
      theme_config: JSON.stringify({
        themeId,
        ...themeConfig,
      }),
    })
    .returning('id');
  
  return { shardId: shard.id, storagePath };
}

/**
 * Deploy shard to Vercel using direct file upload
 */
export async function deployShardToVercel(
  shardId: string,
  vercelProjectId: string
): Promise<DeploymentResult> {
  const tempDir = join(tmpdir(), `shard-${shardId}-${Date.now()}`);
  
  try {
    // 1. Get shard from database
    const shard = await knex('site_shards')
      .where('id', shardId)
      .first();
    
    if (!shard) {
      throw new Error(`Shard ${shardId} not found`);
    }
    
    // 2. Update status to building
    await knex('site_shards')
      .where('id', shardId)
      .update({ status: 'building' });
    
    // 3. Fetch files from storage to temp directory
    const files = JSON.parse(shard.file_manifest) as Record<string, { sha: string; size: number }>;
    const fileList: ShardFile[] = [];
    
    await mkdir(tempDir, { recursive: true });
    
    for (const [path, meta] of Object.entries(files)) {
      const key = `${shard.storage_path}/${path}`;
      
      // Get file from R2
      const response = await storage.send(
        new GetObjectCommand({
          Bucket: BUCKET_NAME,
          Key: key,
        })
      );
      
      const content = await response.Body?.transformToString();
      if (!content) continue;
      
      // Save to temp for processing
      const filePath = join(tempDir, path);
      await mkdir(join(filePath, '..'), { recursive: true });
      await writeFile(filePath, content);
      
      fileList.push({
        path,
        content,
        sha1: meta.sha,
        size: meta.size,
      });
    }
    
    // 4. Deploy to Vercel using direct file upload
    const vercelAdapter = new VercelAdapter(process.env['VERCEL_TOKEN']!);
    
    // TODO: Implement direct file upload method in VercelAdapter
    // This would call Vercel's API with the file list
    const deployment = await vercelAdapter.deployFilesDirectly({
      projectId: vercelProjectId,
      files: fileList.map(f => ({
        file: f.path,
        data: Buffer.from(f.content).toString('base64'),
        encoding: 'base64',
      })),
      target: 'production',
    });
    
    // 5. Update database with deployment info
    await knex('site_shards')
      .where('id', shardId)
      .update({
        status: 'deployed',
        vercel_project_id: vercelProjectId,
        vercel_deployment_id: deployment.id,
        vercel_url: deployment.url,
        deployed_at: new Date().toISOString(),
      });
    
    return {
      success: true,
      deploymentId: deployment.id,
      url: deployment.url,
    };
    
  } catch (error) {
    // Update status to failed
    await knex('site_shards')
      .where('id', shardId)
      .update({
        status: 'failed',
      });
    
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  } finally {
    // Cleanup temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Get presigned URL for downloading shard files
 */
export async function getShardDownloadUrl(
  shardId: string,
  filePath: string,
  expiresIn: number = 3600
): Promise<string | null> {
  const shard = await knex('site_shards')
    .where('id', shardId)
    .first();
  
  if (!shard) return null;
  
  const key = `${shard.storage_path}/${filePath}`;
  
  const command = new GetObjectCommand({
    Bucket: BUCKET_NAME,
    Key: key,
  });
  
  return getSignedUrl(storage, command, { expiresIn });
}

/**
 * List all versions for a site
 */
export async function listShardVersions(siteId: string) {
  return knex('site_shards')
    .where('site_id', siteId)
    .orderBy('version', 'desc')
    .select([
      'id',
      'version',
      'status',
      'vercel_url',
      'created_at',
      'deployed_at',
    ]);
}

/**
 * Rollback to previous version
 */
export async function rollbackShard(
  siteId: string,
  targetVersion: number,
  vercelProjectId: string
): Promise<DeploymentResult> {
  const targetShard = await knex('site_shards')
    .where({
      site_id: siteId,
      version: targetVersion,
    })
    .first();
  
  if (!targetShard) {
    return {
      success: false,
      error: `Version ${targetVersion} not found`,
    };
  }
  
  // Redeploy existing shard
  return deployShardToVercel(targetShard.id, vercelProjectId);
}
