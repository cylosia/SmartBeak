/**
 * Resource Limits Configuration
 * 
 * System resource and quota settings.
 */

import { parseIntEnv } from './env';

export const resourceLimits = {
  /** Maximum concurrent database connections (capped at 100) */
  maxDbConnections: Math.min(parseIntEnv('MAX_DB_CONNECTIONS', 20), 100),

  /** Maximum concurrent API requests per instance (capped at 1000) */
  maxConcurrentRequests: Math.min(parseIntEnv('MAX_CONCURRENT_REQUESTS', 100), 1000),

  /** Maximum queue depth before backpressure (capped at 10000) */
  maxQueueDepth: Math.min(parseIntEnv('MAX_QUEUE_DEPTH', 1000), 10000),

  /** Maximum memory usage before triggering GC (in MB, capped at 4096) */
  maxMemoryMB: Math.min(parseIntEnv('MAX_MEMORY_MB', 512), 4096),

  /** Maximum payload size in bytes (10MB default, capped at 50MB) */
  maxPayloadSize: Math.min(parseIntEnv('MAX_PAYLOAD_SIZE', 10 * 1024 * 1024), 50 * 1024 * 1024),

  /** Maximum file upload size in bytes (P2-FIX: reduced default from 100MB to 20MB, capped at 100MB) */
  maxFileUploadSize: Math.min(parseIntEnv('MAX_FILE_UPLOAD_SIZE', 20 * 1024 * 1024), 100 * 1024 * 1024),
} as const;
