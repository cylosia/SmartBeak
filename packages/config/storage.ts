/**
 * Storage Configuration
 * 
 * Centralized configuration for object storage (R2, S3, GCS, etc.)
 * Used by the shard deployment system and other file storage needs.
 */

import { S3Client, S3ClientConfig } from '@aws-sdk/client-s3';

// Storage provider types
export type StorageProvider = 'r2' | 's3' | 'gcs' | 'local';

// Storage configuration interface
export interface StorageConfig {
  provider: StorageProvider;
  bucketName: string;
  endpoint?: string | undefined;
  region?: string | undefined;
  credentials: {
    accessKeyId: string;
    secretAccessKey: string;
  };
  publicDomain?: string | undefined;
}

/**
 * Get storage configuration from environment variables
 */
export function getStorageConfig(): StorageConfig {
  const provider = (process.env['STORAGE_BACKEND'] as StorageProvider) || 'r2';
  
  switch (provider) {
    case 'r2':
      return getR2Config();
    case 's3':
      return getS3Config();
    case 'gcs':
      return getGCSConfig();
    case 'local':
      return getLocalConfig();
    default:
      throw new Error(`Unsupported storage provider: ${provider}`);
  }
}

/**
 * Get Cloudflare R2 configuration
 */
function getR2Config(): StorageConfig {
  const accountId = process.env['R2_ACCOUNT_ID'];
  const accessKeyId = process.env['R2_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['R2_SECRET_ACCESS_KEY'];
  const bucketName = process.env['R2_BUCKET_NAME'];
  
  if (!accountId || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error(
      'Missing R2 configuration. Required: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME'
    );
  }
  
  return {
    provider: 'r2',
    bucketName,
    endpoint: process.env['R2_ENDPOINT'] || `https://${accountId}.r2.cloudflarestorage.com`,
    region: 'auto',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
    publicDomain: process.env['R2_PUBLIC_DOMAIN'],
  };
}

/**
 * Get AWS S3 configuration
 */
function getS3Config(): StorageConfig {
  const accessKeyId = process.env['AWS_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['AWS_SECRET_ACCESS_KEY'];
  const bucketName = process.env['S3_BUCKET_NAME'] || process.env['R2_BUCKET_NAME'];
  
  if (!accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error(
      'Missing S3 configuration. Required: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME'
    );
  }
  
  return {
    provider: 's3',
    bucketName,
    endpoint: process.env['S3_ENDPOINT'],
    region: process.env['AWS_REGION'] || 'us-east-1',
    credentials: {
      accessKeyId,
      secretAccessKey,
    },
  };
}

/**
 * Get Google Cloud Storage configuration
 */
function getGCSConfig(): StorageConfig {
  const projectId = process.env['GOOGLE_CLOUD_PROJECT_ID'];
  const bucketName = process.env['GOOGLE_CLOUD_STORAGE_BUCKET'];
  
  if (!projectId || !bucketName) {
    throw new Error(
      'Missing GCS configuration. Required: GOOGLE_CLOUD_PROJECT_ID, GOOGLE_CLOUD_STORAGE_BUCKET'
    );
  }
  
  // GCS uses a different client, but we return a compatible config
  // The actual GCS client initialization would be done separately
  return {
    provider: 'gcs',
    bucketName,
    region: process.env['GOOGLE_CLOUD_REGION'] || 'us-central1',
    credentials: {
      // GCS uses service account JSON, these would be dummy values
      // Actual auth is handled via GOOGLE_APPLICATION_CREDENTIALS
      accessKeyId: 'gcs',
      secretAccessKey: 'gcs',
    },
  };
}

/**
 * Get local filesystem configuration (for development)
 */
function getLocalConfig(): StorageConfig {
  return {
    provider: 'local',
    bucketName: process.env['LOCAL_STORAGE_PATH'] || './storage/shards',
    credentials: {
      accessKeyId: 'local',
      secretAccessKey: 'local',
    },
  };
}

/**
 * Create an S3-compatible client
 * Works with R2, S3, and MinIO
 */
export function createStorageClient(config?: StorageConfig): S3Client {
  const storageConfig = config || getStorageConfig();
  
  const clientConfig: S3ClientConfig = {
    region: storageConfig.region || 'auto',
    credentials: storageConfig.credentials,
  };
  
  // Add endpoint for R2, MinIO, or custom S3-compatible storage
  if (storageConfig.endpoint) {
    clientConfig.endpoint = storageConfig.endpoint;
    
    // Required for R2 and MinIO compatibility
    clientConfig.forcePathStyle = true;
  }
  
  return new S3Client(clientConfig);
}

/**
 * Get the bucket name
 */
export function getBucketName(): string {
  return getStorageConfig().bucketName;
}

/**
 * Build a storage path for a shard
 */
export function buildShardPath(siteId: string, version: number): string {
  return `shards/${siteId}/v${version}`;
}

/**
 * Build a public URL for a file (if public access is enabled)
 */
export function buildPublicUrl(path: string, config?: StorageConfig): string | null {
  const storageConfig = config || getStorageConfig();
  
  if (storageConfig.publicDomain) {
    return `${storageConfig.publicDomain}/${path}`;
  }
  
  if (storageConfig.provider === 'r2') {
    // F26-FIX: Do not expose raw R2 endpoint URL (contains Cloudflare account ID)
    // in public URLs. Require R2_PUBLIC_DOMAIN for public access.
    // Previously: returned endpoint URL which leaked infrastructure details.
    return null;
  }
  
  if (storageConfig.provider === 's3') {
    const region = storageConfig.region || 'us-east-1';
    return `https://${storageConfig.bucketName}.s3.${region}.amazonaws.com/${path}`;
  }
  
  return null;
}

/**
 * Validate storage configuration
 */
export function validateStorageConfig(): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  
  try {
    const config = getStorageConfig();
    
    if (!config.bucketName) {
      errors.push('Bucket name is required');
    }
    
    if (!config.credentials.accessKeyId) {
      errors.push('Access key ID is required');
    }
    
    if (!config.credentials.secretAccessKey) {
      errors.push('Secret access key is required');
    }
    
    if (config.provider === 'r2' && !config.endpoint) {
      errors.push('R2 endpoint is required (set R2_ENDPOINT or R2_ACCOUNT_ID)');
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown configuration error');
  }
  
  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Get shard deployment configuration
 */
export function getShardDeploymentConfig() {
  return {
    maxSizeBytes: parseInt(process.env['SHARD_MAX_SIZE_BYTES'] || '10485760', 10),
    maxFiles: parseInt(process.env['SHARD_MAX_FILES'] || '500', 10),
    uploadConcurrency: parseInt(process.env['SHARD_UPLOAD_CONCURRENCY'] || '10', 10),
    deploymentTimeoutMs: parseInt(process.env['SHARD_DEPLOYMENT_TIMEOUT_MS'] || '300000', 10),
    versioningEnabled: process.env['SHARD_VERSIONING_ENABLED'] !== 'false',
    maxVersionsPerSite: parseInt(process.env['SHARD_MAX_VERSIONS_PER_SITE'] || '10', 10),
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    tempDir: process.env['SHARD_TEMP_DIR'] || require('os').tmpdir(),
  };
}

/**
 * Get theme configuration
 */
export function getThemeConfig() {
  return {
    defaultThemeId: process.env['DEFAULT_THEME_ID'] || 'affiliate-comparison',
    availableThemes: (process.env['AVAILABLE_THEMES'] || 'affiliate-comparison').split(','),
    templateDir: process.env['THEME_TEMPLATE_DIR'] || 'themes',
  };
}

export default {
  getStorageConfig,
  createStorageClient,
  getBucketName,
  buildShardPath,
  buildPublicUrl,
  validateStorageConfig,
  getShardDeploymentConfig,
  getThemeConfig,
};
