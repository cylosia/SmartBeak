/**
* Database Schema Validation

*
* This module provides validation for JSONB fields before they are
* persisted to the database.
*/

// ============================================================================
// Notification Payload Types
// ============================================================================

export interface NotificationAttachment {
  filename: string;
  contentType: string;
  size: number;
  url: string;
}

export interface NotificationPayload {
  subject?: string;
  body?: string;
  htmlBody?: string;
  actionUrl?: string;
  actionText?: string;
  data?: Record<string, unknown>;
  attachments?: NotificationAttachment[];
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  trackingId?: string;
}

// ============================================================================
// Search Document Fields Types
// ============================================================================

export interface SearchDocumentAuthor {
  id: string;
  name: string;
}

export interface SearchDocumentFields {
  title: string;
  description?: string;
  content?: string;
  category?: string;
  tags?: string[];
  author?: SearchDocumentAuthor;
  publishedAt?: string;
  modifiedAt?: string;
  attributes?: Record<string, string | number | boolean | string[]>;
  url?: string;
  imageUrl?: string;
}

// ============================================================================
// Publish Target Config Types
// ============================================================================

export interface PublishTargetRetryPolicy {
  maxRetries: number;
  retryDelay: number;
  backoffMultiplier: number;
}

export interface PublishTargetAuth {
  type: 'none' | 'bearer' | 'basic' | 'apiKey';
  token?: string;
  username?: string;
  password?: string;
}

export interface PublishTargetRateLimit {
  requestsPerSecond: number;
  burstSize: number;
}

export interface PublishTargetContentTransform {
  format: 'json' | 'xml' | 'html' | 'markdown';
  includeMetadata: boolean;
  customFields?: Record<string, string>;
}

export interface PublishTargetConfig {
  webhookUrl?: string;
  webhookSecret?: string;
  webhookHeaders?: Record<string, string>;
  apiEndpoint?: string;
  apiKey?: string;
  apiVersion?: string;
  retryPolicy?: PublishTargetRetryPolicy;
  timeout?: number;
  contentTransform?: PublishTargetContentTransform;
  auth?: PublishTargetAuth;
  rateLimit?: PublishTargetRateLimit;
}

// ============================================================================
// Validation Error
// ============================================================================

export class SchemaValidationError extends Error {
  constructor(
  message: string,
  public readonly field: string,
  public readonly issues: string[]
  ) {
  super(message);
  this["name"] = 'SchemaValidationError';
  }
}

// ============================================================================
// Validation Functions
// ============================================================================

/**
* Validate notification payload

*/
export function validateNotificationPayload(payload: unknown): NotificationPayload {
  // P2-19 FIX: Removed duplicate null check (was checked twice in succession)
  if (payload === null || typeof payload !== 'object') {
  throw new SchemaValidationError('Payload must be an object', 'payload', ['Expected object']);
  }

  const p = payload as Record<string, unknown>;
  const issues: string[] = [];

  // Validate subject if present
  if (p['subject'] !== undefined) {
  if (typeof p['subject'] !== 'string') issues.push('subject must be a string');
  else if ((p['subject'] as string).length > 500) issues.push('subject must be at most 500 characters');
  }

  // Validate body if present
  if (p['body'] !== undefined) {
  if (typeof p['body'] !== 'string') issues.push('body must be a string');
  else if ((p['body'] as string).length > 10000) issues.push('body must be at most 10000 characters');
  }

  // Validate htmlBody if present
  if (p['htmlBody'] !== undefined) {
  if (typeof p['htmlBody'] !== 'string') issues.push('htmlBody must be a string');
  else if ((p['htmlBody'] as string).length > 50000) issues.push('htmlBody must be at most 50000 characters');
  }

  // Validate actionUrl if present
  if (p['actionUrl'] !== undefined) {
  if (typeof p['actionUrl'] !== 'string') issues.push('actionUrl must be a string');
  else if ((p['actionUrl'] as string).length > 2000) issues.push('actionUrl must be at most 2000 characters');
  else if (!isValidUrl(p['actionUrl'] as string)) issues.push('actionUrl must be a valid URL');
  }

  // Validate actionText if present
  if (p['actionText'] !== undefined) {
  if (typeof p['actionText'] !== 'string') issues.push('actionText must be a string');
  else if ((p['actionText'] as string).length > 100) issues.push('actionText must be at most 100 characters');
  }

  // Validate priority if present
  if (p['priority'] !== undefined) {
  const validPriorities = ['low', 'normal', 'high', 'urgent'];
  if (!validPriorities.includes(p['priority'] as string)) {
    issues.push(`priority must be one of: ${validPriorities.join(', ')}`);
  }
  }

  // Validate attachments if present
  if (p['attachments'] !== undefined) {
  if (!Array.isArray(p['attachments'])) {
    issues.push('attachments must be an array');
  } else if (p['attachments'].length > 10) {
    issues.push('attachments must have at most 10 items');
  } else {
    for (let i = 0; i < p['attachments'].length; i++) {
    // BUG-DS-01 fix: guard against null/non-object array elements before casting.
    // Previously `p['attachments'][i] as Record<string, unknown>` was an unchecked
    // cast — a null element would produce a TypeError when accessing properties.
    const rawAtt = p['attachments'][i];
    if (rawAtt === null || rawAtt === undefined || typeof rawAtt !== 'object') {
      issues.push(`attachments[${i}] must be an object`);
      continue;
    }
    const att = rawAtt as Record<string, unknown>;
    if (typeof att['filename'] !== 'string' || (att['filename'] as string).length > 255) {
    issues.push(`attachments[${i}].filename must be a string (max 255 chars)`);
    }
    if (typeof att['contentType'] !== 'string' || (att['contentType'] as string).length > 100) {
    issues.push(`attachments[${i}].contentType must be a string (max 100 chars)`);
    }
    if (typeof att['size'] !== 'number' || att['size'] < 0 || att['size'] > 50 * 1024 * 1024) {
    issues.push(`attachments[${i}].size must be a number (0-50MB)`);
    }
    // BUG-DS-02 fix: validate URL format (not just length). The attachment URL is
    // used downstream by adapters to fetch content; accepting arbitrary strings
    // (e.g. javascript:, file://, internal hostnames) is an SSRF vector.
    if (typeof att['url'] !== 'string') {
      issues.push(`attachments[${i}].url must be a string`);
    } else if ((att['url'] as string).length > 2000) {
      issues.push(`attachments[${i}].url must be at most 2000 characters`);
    } else if (!isValidUrl(att['url'] as string)) {
      issues.push(`attachments[${i}].url must be a valid http/https URL`);
    }
    }
  }
  }

  if (issues.length > 0) {
  throw new SchemaValidationError('Invalid notification payload', 'payload', issues);
  }

  return p as NotificationPayload;
}

/**
* Validate search document fields

*/
export function validateSearchDocumentFields(fields: unknown): SearchDocumentFields {
  // P2-19 FIX: Removed duplicate null check
  if (fields === null || typeof fields !== 'object') {
  throw new SchemaValidationError('Fields must be an object', 'fields', ['Expected object']);
  }

  const f = fields as Record<string, unknown>;
  const issues: string[] = [];

  // Validate required title
  if (typeof f['title'] !== 'string') {
  issues.push('title is required and must be a string');
  } else {
  if ((f['title'] as string).length < 1) issues.push('title must not be empty');
  if ((f['title'] as string).length > 500) issues.push('title must be at most 500 characters');
  }

  // Validate description if present
  if (f['description'] !== undefined) {
  if (typeof f['description'] !== 'string') issues.push('description must be a string');
  else if ((f['description'] as string).length > 2000) issues.push('description must be at most 2000 characters');
  }

  // Validate content if present
  if (f['content'] !== undefined) {
  if (typeof f['content'] !== 'string') issues.push('content must be a string');
  else if ((f['content'] as string).length > 50000) issues.push('content must be at most 50000 characters');
  }

  // Validate tags if present
  if (f['tags'] !== undefined) {
  if (!Array.isArray(f['tags'])) {
    issues.push('tags must be an array');
  } else if (f['tags'].length > 50) {
    issues.push('tags must have at most 50 items');
  } else {
    for (let i = 0; i < f['tags'].length; i++) {
    const tag = f['tags'][i];
    if (typeof tag !== 'string' || tag.length > 50) {
    issues.push(`tags[${i}] must be a string (max 50 chars)`);
    }
    }
  }
  }

  // Validate url if present
  if (f['url'] !== undefined) {
  if (typeof f['url'] !== 'string') issues.push('url must be a string');
  else if ((f['url'] as string).length > 2000) issues.push('url must be at most 2000 characters');
  else if (!isValidUrl(f['url'] as string)) issues.push('url must be a valid URL');
  }

  // Validate imageUrl if present
  if (f['imageUrl'] !== undefined) {
  if (typeof f['imageUrl'] !== 'string') issues.push('imageUrl must be a string');
  else if ((f['imageUrl'] as string).length > 2000) issues.push('imageUrl must be at most 2000 characters');
  else if (!isValidUrl(f['imageUrl'] as string)) issues.push('imageUrl must be a valid URL');
  }

  if (issues.length > 0) {
  throw new SchemaValidationError('Invalid search document fields', 'fields', issues);
  }

  // BUG-DS-03 fix: removed redundant type guard that checked only `typeof title === 'string'`.
  // If we reach this point, all validations above have already passed — the guard was
  // always true and created false confidence (it did NOT enforce length constraints).
  return f as SearchDocumentFields;
}

/**
* Validate publish target config

*/
export function validatePublishTargetConfig(config: unknown): PublishTargetConfig {
  // P2-19 FIX: Removed duplicate null check
  if (config === null || typeof config !== 'object') {
  throw new SchemaValidationError('Config must be an object', 'config', ['Expected object']);
  }

  const c = config as Record<string, unknown>;
  const issues: string[] = [];

  // Validate webhookUrl if present
  if (c['webhookUrl'] !== undefined) {
  if (typeof c['webhookUrl'] !== 'string') issues.push('webhookUrl must be a string');
  else if ((c['webhookUrl'] as string).length > 2000) issues.push('webhookUrl must be at most 2000 characters');
  else if (!isValidUrl(c['webhookUrl'] as string)) issues.push('webhookUrl must be a valid URL');
  }

  // Validate apiEndpoint if present
  if (c['apiEndpoint'] !== undefined) {
  if (typeof c['apiEndpoint'] !== 'string') issues.push('apiEndpoint must be a string');
  else if ((c['apiEndpoint'] as string).length > 2000) issues.push('apiEndpoint must be at most 2000 characters');
  else if (!isValidUrl(c['apiEndpoint'] as string)) issues.push('apiEndpoint must be a valid URL');
  }

  // Validate timeout if present
  if (c['timeout'] !== undefined) {
  if (typeof c['timeout'] !== 'number') issues.push('timeout must be a number');
  else if (c['timeout'] < 1000 || c['timeout'] > 300000) {
    issues.push('timeout must be between 1000 and 300000 ms');
  }
  }

  // Validate retryPolicy if present
  if (c['retryPolicy'] !== undefined) {
  if (typeof c['retryPolicy'] !== 'object' || c['retryPolicy'] === null) {
    issues.push('retryPolicy must be an object');
  } else {
    const rp = c['retryPolicy'] as Record<string, unknown>;
    if (rp['maxRetries'] !== undefined && (typeof rp['maxRetries'] !== 'number' || rp['maxRetries'] < 0 || rp['maxRetries'] > 10)) {
    issues.push('retryPolicy.maxRetries must be a number (0-10)');
    }
    if (rp['retryDelay'] !== undefined && (typeof rp['retryDelay'] !== 'number' || rp['retryDelay'] < 100 || rp['retryDelay'] > 60000)) {
    issues.push('retryPolicy.retryDelay must be a number (100-60000 ms)');
    }
  }
  }

  // Validate auth if present
  if (c['auth'] !== undefined) {
  if (typeof c['auth'] !== 'object' || c['auth'] === null) {
    issues.push('auth must be an object');
  } else {
    const auth = c['auth'] as Record<string, unknown>;
    const validAuthTypes = ['none', 'bearer', 'basic', 'apiKey'];
    if (!validAuthTypes.includes(auth['type'] as string)) {
    issues.push(`auth.type must be one of: ${validAuthTypes.join(', ')}`);
    }
  }
  }

  if (issues.length > 0) {
  throw new SchemaValidationError('Invalid publish target config', 'config', issues);
  }

  return c as PublishTargetConfig;
}

/**
* Safe validation that returns null instead of throwing
*/
export function safeValidateNotificationPayload(payload: unknown): NotificationPayload | null {
  try {
  return validateNotificationPayload(payload);
  } catch {
  return null;
  }
}

export function safeValidateSearchDocumentFields(fields: unknown): SearchDocumentFields | null {
  try {
  return validateSearchDocumentFields(fields);
  } catch {
  return null;
  }
}

export function safeValidatePublishTargetConfig(config: unknown): PublishTargetConfig | null {
  try {
  return validatePublishTargetConfig(config);
  } catch {
  return null;
  }
}

/**
* Helper function to validate URL format.
* P0-SSRF-FIX: The previous implementation accepted ANY valid URL including
* javascript:, data:, file://, and ftp:// schemes. For fields like webhookUrl
* and apiEndpoint the server actively calls these URLs, making unrestricted
* scheme acceptance a direct SSRF vector. Only https:// and http:// are permitted.
*/
function isValidUrl(url: string): boolean {
  try {
  const parsed = new URL(url);
  // Only permit http and https — block javascript:, data:, file://, ftp://, etc.
  return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
  return false;
  }
}
