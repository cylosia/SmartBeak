/**
 * Resource Limits Configuration
 * 
 * System resource and quota settings.
 */

import { parseIntEnv } from './env';

export const resourceLimits = {
  /** Maximum concurrent database connections */
  maxDbConnections: parseIntEnv('MAX_DB_CONNECTIONS', 20),

  /** Maximum concurrent API requests per instance */
  maxConcurrentRequests: parseIntEnv('MAX_CONCURRENT_REQUESTS', 100),

  /** Maximum queue depth before backpressure */
  maxQueueDepth: parseIntEnv('MAX_QUEUE_DEPTH', 1000),

  /** Maximum memory usage before triggering GC (in MB) */
  maxMemoryMB: parseIntEnv('MAX_MEMORY_MB', 512),

  /** Maximum payload size in bytes (10MB default) */
  maxPayloadSize: parseIntEnv('MAX_PAYLOAD_SIZE', 10 * 1024 * 1024),

  /** Maximum file upload size in bytes (100MB default) */
  maxFileUploadSize: parseIntEnv('MAX_FILE_UPLOAD_SIZE', 100 * 1024 * 1024),
} as const;
