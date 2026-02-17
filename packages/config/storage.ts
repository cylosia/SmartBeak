/**
 * Storage Configuration
 *
 * Object storage (S3/R2) settings for file uploads and shard deployments.
 */

export const storageConfig = {
  get bucket(): string {
    const val = process.env['STORAGE_BUCKET'];
    if (!val) {
      throw new Error('STORAGE_BUCKET environment variable is required');
    }
    return val;
  },

  get region(): string {
    return process.env['STORAGE_REGION'] || 'us-east-1';
  },

  get accessKeyId(): string {
    const val = process.env['STORAGE_ACCESS_KEY_ID'];
    if (!val) {
      throw new Error('STORAGE_ACCESS_KEY_ID environment variable is required');
    }
    return val;
  },

  get secretAccessKey(): string {
    const val = process.env['STORAGE_SECRET_ACCESS_KEY'];
    if (!val) {
      throw new Error('STORAGE_SECRET_ACCESS_KEY environment variable is required');
    }
    return val;
  },

  get endpoint(): string | undefined {
    return process.env['STORAGE_ENDPOINT'];
  },
} as const;
