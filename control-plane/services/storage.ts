
import { randomUUID, createHmac, createHash } from 'crypto';

import { ValidationError, ServiceUnavailableError } from '@errors';

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
  throw new ServiceUnavailableError('Storage configuration incomplete');
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

  // SECURITY FIX: URI-encode each path segment per AWS SigV4 spec.
  // Without this, special characters in storageKey cause signature mismatches.
  const canonicalUri = '/' + storageKey
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');

  // SECURITY FIX: Build canonical query string from sorted parameters using
  // encodeURIComponent for both keys and values (RFC 3986 percent-encoding).
  // Previously hard-coded parameter order was fragile, and url.searchParams.set()
  // used application/x-www-form-urlencoded encoding (space='+') which differs
  // from encodeURIComponent (space='%20'), causing signature mismatches.
  const queryParams: Record<string, string> = {
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${credentialScope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': expiresInSeconds.toString(),
    'X-Amz-SignedHeaders': 'host',
  };

  const canonicalQuerystring = Object.keys(queryParams)
    .sort()
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(queryParams[key]!)}`)
    .join('&');

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = 'host';
  const payloadHash = 'UNSIGNED-PAYLOAD';

  const canonicalRequest = [
  method,
  canonicalUri,
  canonicalQuerystring,
  canonicalHeaders,
  signedHeaders,
  payloadHash,
  ].join('\n');

  // Create string to sign
  const stringToSign = [
  'AWS4-HMAC-SHA256',
  amzDate,
  credentialScope,
  createHash('sha256').update(canonicalRequest).digest('hex')
  ].join('\n');

  // Calculate signature
  const signingKey = getSigningKey(config.secretAccessKey, dateStamp, config.region, 's3');
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  // Build the signed URL using the same canonical query string encoding
  // to ensure the signature matches what the server computes from the URL.
  const baseUrl = config.endpoint
  ? `${config.endpoint}/${config.bucket}`
  : `https://${config.bucket}.s3.${config.region}.amazonaws.com`;

  const signedUrl = `${baseUrl}/${storageKey}?${canonicalQuerystring}&X-Amz-Signature=${signature}`;

  return {
  url: signedUrl,
  expiresIn: expiresInSeconds
  };
}

// P1-FIX: Use an explicit allowlist with no wildcard prefix fallback.
// Previously:
//   1. 'image/svg+xml' was listed — SVG is XML that executes JavaScript, enabling
//      stored XSS when served from the same origin.
//   2. mimeType.startsWith('image/') caught any image/* type, including SVG,
//      defeating the allowlist entirely.
// Now every accepted MIME type must be explicitly listed.
const VALID_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'video/mp4',
  'video/webm',
  'video/ogg',
  'audio/mpeg',
  'audio/wav',
  'audio/ogg',
  'audio/webm',
  'application/pdf',
]);

function validateMimeType(mimeType: string): boolean {
  if (!mimeType || typeof mimeType !== 'string') return false;
  return VALID_MIME_TYPES.has(mimeType.toLowerCase());
}

export function generateStorageKey(domain: string, mimeType?: string): string {
  if (!domain || typeof domain !== 'string') {
  throw new ValidationError('Valid domain string is required');
  }
  if (mimeType !== undefined && !validateMimeType(mimeType)) {
  throw new ValidationError(`Invalid MIME type: ${mimeType}`);
  }
  // Sanitize domain to prevent path traversal
  const sanitizedDomain = domain.replace(/[^a-zA-Z0-9\-_]/g, '_');
  return `${sanitizedDomain}/${randomUUID()}`;
}
