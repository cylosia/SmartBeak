
import { randomUUID, createHmac, createHash } from 'crypto';

export interface SignedUrlConfig {
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  endpoint?: string | undefined;
}

export interface SignedUrlResult {
  url: string;
  expiresIn: number;
}

function getStorageConfig(): SignedUrlConfig {
  const bucket = process.env['STORAGE_BUCKET'];
  const region = process.env['STORAGE_REGION'] || 'us-east-1';
  const accessKeyId = process.env['STORAGE_ACCESS_KEY_ID'];
  const secretAccessKey = process.env['STORAGE_SECRET_ACCESS_KEY'];
  const endpoint = process.env['STORAGE_ENDPOINT'];

  if (!bucket || !accessKeyId || !secretAccessKey) {
  throw new Error('Storage configuration missing: STORAGE_BUCKET, STORAGE_ACCESS_KEY_ID, STORAGE_SECRET_ACCESS_KEY required');
  }

  return { bucket, region, accessKeyId, secretAccessKey, endpoint };
}

/**
* Generate AWS Signature v4 signing key
* Derives a signing key from the secret access key using HMAC-SHA256
*/
function getSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Buffer {
  const kDate = createHmac('sha256', `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac('sha256', kDate).update(region).digest();
  const kService = createHmac('sha256', kRegion).update(service).digest();
  const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
  return kSigning;
}

/**
* Generate a signed upload URL for storage (S3/GCS/R2 compatible)
*/
export function generateSignedUploadUrl(storageKey: string, expiresInSeconds = 300): SignedUrlResult {
  const config = getStorageConfig();
  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  const amzDate = now.toISOString().replace(/[:-]|\..*/g, '');
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;

  // Build the canonical request components
  const host = config.endpoint
  ? new URL(config.endpoint).host
  : `${config.bucket}.s3.${config.region}.amazonaws.com`;

  // Create canonical request
  const method = 'PUT';
  const canonicalUri = `/${storageKey}`;
  const canonicalQuerystring = `X-Amz-Algorithm=AWS4-HMAC-SHA256&` +
  `X-Amz-Credential=${encodeURIComponent(`${config.accessKeyId}/${credentialScope}`)}&` +
  `X-Amz-Date=${amzDate}&` +
  `X-Amz-Expires=${expiresInSeconds}&` +
  `X-Amz-SignedHeaders=host`;

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
  ].join('\n');

  // Create string to sign
  const stringToSign = [
  'AWS4-HMAC-SHA256',
  createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');

  // Calculate signature
  const signingKey = getSigningKey(config.secretAccessKey, dateStamp, config.region, 's3');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  // Build the signed URL
  const baseUrl = config.endpoint
  ? `${config.endpoint}/${config.bucket}`
  : `https://${config.bucket}.s3.${config.region}.amazonaws.com`;

  const url = new URL(`${baseUrl}/${storageKey}`);
  url.searchParams.set('X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
  url.searchParams.set('X-Amz-Credential', `${config.accessKeyId}/${credentialScope}`);
  url.searchParams.set('X-Amz-Date', amzDate);
  url.searchParams.set('X-Amz-Expires', expiresInSeconds.toString());
  url.searchParams.set('X-Amz-SignedHeaders', 'host');
  url.searchParams.set('X-Amz-Signature', signature);

  return {
  url: url.toString(),
  expiresIn: expiresInSeconds
  };
}

const VALID_MIME_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml',
  'video/mp4', 'video/webm', 'video/ogg',
  'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm',
  'application/pdf', 'application/json', 'application/xml',
  'text/plain', 'text/html', 'text/css', 'text/javascript',
]);

function validateMimeType(mimeType: string): boolean {
  if (!mimeType || typeof mimeType !== 'string') return false;
  return VALID_MIME_TYPES.has(mimeType.toLowerCase()) ||
    mimeType.startsWith('image/') ||
    mimeType.startsWith('video/') ||
    mimeType.startsWith('audio/');
}

export function generateStorageKey(domain: string, mimeType?: string): string {
  if (!domain || typeof domain !== 'string') {
  throw new Error('Valid domain string is required');
  }
  if (mimeType !== undefined && !validateMimeType(mimeType)) {
  throw new Error(`Invalid MIME type: ${mimeType}`);
  }
  // Sanitize domain to prevent path traversal
  const sanitizedDomain = domain.replace(/[^a-zA-Z0-9\-_]/g, '_');
  return `${sanitizedDomain}/${randomUUID()}`;
}
