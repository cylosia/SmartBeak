

import crypto from 'crypto';

import { getLogger } from '@kernel/logger';

import { getRequestId } from './request-context';

/**
* Dead Letter Queue (DLQ) Service
*
* MEDIUM FIX M15: Missing Dead Letter Queue for Failed Jobs

*/

const logger = getLogger('dlq');

// ============================================================================
// JSON Types (Bigint-safe)
// ============================================================================

/**
* JSON-compatible value type
* Excludes bigint, functions, symbols, and undefined
*/
export type JSONValue =
  | string
  | number
  | boolean
  | null
  | JSONValue[]
  | { [key: string]: JSONValue };

/**
* Error information for DLQ message
*/
export interface DLQError {
  message: string;
  stack?: string | undefined;
  code?: string | undefined;
}

/**
* Dead Letter Queue message structure

*/
export interface DLQMessage {
  id: string;
  originalQueue: string;
  payload: JSONValue;
  error: DLQError;
  attempts: number;
  maxAttempts: number;
  failedAt: string;
  firstFailedAt: string;
  requestId?: string;
  metadata?: Record<string, JSONValue>;
}

export interface DLQStorage {
  enqueue(message: DLQMessage): Promise<void>;
  dequeue(id: string): Promise<DLQMessage | null>;
  peek(limit: number): Promise<DLQMessage[]>;
  delete(id: string): Promise<void>;
  retry(id: string): Promise<void>;
  count(): Promise<number>;
}

/**
* P0-FIX: In-memory DLQ implementation with single cleanup interval
* Prevents memory leak from per-item setTimeout
*/
class InMemoryDLQStorage implements DLQStorage {
  private readonly messages = new Map<string, DLQMessage>();
  private readonly retryCallbacks = new Map<string, () => Promise<void>>();

  private readonly MAX_SIZE = 10000;
  private readonly DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
  private readonly timestamps = new Map<string, number>();
  // P0-FIX: Single cleanup interval instead of per-item setTimeout
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;
  private readonly CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // Run cleanup every hour

  constructor() {
    // P0-FIX: Start single cleanup interval
    this.startCleanupInterval();
  }

  private startCleanupInterval(): void {
    if (this.cleanupInterval) return;

    this.cleanupInterval = setInterval(() => {
    this.cleanupExpiredMessages();
    }, this.CLEANUP_INTERVAL_MS);

    // Ensure interval doesn't prevent process exit
    if (this.cleanupInterval.unref) {
    this.cleanupInterval.unref();
    }
  }

  private cleanupExpiredMessages(): void {
    const now = Date.now();
    const expiredIds: string[] = [];

    for (const [id, timestamp] of this.timestamps.entries()) {
    if (now - timestamp > this.DEFAULT_TTL_MS) {
        expiredIds.push(id);
    }
    }

    for (const id of expiredIds) {
    this.messages.delete(id);
    this.timestamps.delete(id);
    this.retryCallbacks.delete(id);
    logger.info(`DLQ message ${id} expired and removed`);
    }

    if (expiredIds.length > 0) {
    logger.debug(`DLQ cleanup completed`, {
        expiredCount: expiredIds.length,
        remainingCount: this.messages.size
    });
    }
  }

  // P0-FIX: Method to stop cleanup interval (for testing/shutdown)
  stopCleanupInterval(): void {
    if (this.cleanupInterval) {
    clearInterval(this.cleanupInterval);
    this.cleanupInterval = null;
    }
  }

  async enqueue(message: DLQMessage): Promise<void> {

  if (this.messages.size >= this.MAX_SIZE) {
    // Remove oldest message (FIFO)
    const oldestKey = this.messages.keys().next().value;
    if (oldestKey) {
    this.messages.delete(oldestKey);
    this.timestamps.delete(oldestKey);
    this.retryCallbacks.delete(oldestKey);
    logger.warn('DLQ size limit reached, removed oldest message', {
    removedId: oldestKey,
    currentSize: this.messages.size
    });
    }
  }

  this.messages.set(message.id, message);
  this.timestamps.set(message.id, Date.now());
  // P0-FIX: No per-item setTimeout - cleanup is handled by interval

  logger.warn(`Message ${message.id} moved to DLQ`, {
    originalQueue: message.originalQueue,
    attempts: message.attempts,
    error: message["error"]["message"],
  });
  }

  async dequeue(id: string): Promise<DLQMessage | null> {
  const message = this.messages.get(id);
  if (message) {
    this.messages.delete(id);
  }
  return message || null;
  }

  async peek(limit: number): Promise<DLQMessage[]> {
  return Array.from(this.messages.values())
    .sort((a, b) => new Date(b.failedAt).getTime() - new Date(a.failedAt).getTime())
    .slice(0, limit);
  }

  async delete(id: string): Promise<void> {
  this.messages.delete(id);
  this.retryCallbacks.delete(id);
  }

  async retry(id: string): Promise<void> {
  const callback = this.retryCallbacks.get(id);
  if (callback) {
    await callback();
    await this.delete(id);
  }
  }

  async count(): Promise<number> {
  return this.messages.size;
  }

  registerRetryCallback(id: string, callback: () => Promise<void>): void {
  this.retryCallbacks.set(id, callback);
  }
}

// ============================================================================
// Global DLQ Storage (encapsulated)
// ============================================================================

const dlqStorageStore = {
  storage: new InMemoryDLQStorage() as DLQStorage
};

// Read-only access
const getDLQStorageInstance = (): DLQStorage => dlqStorageStore.storage;

/**
* Set DLQ storage implementation

*/
export function setDLQStorage(storage: DLQStorage): void {
  if (!storage || typeof storage.enqueue !== 'function') {
  throw new Error('Invalid DLQ storage: must implement DLQStorage interface');
  }
  dlqStorageStore.storage = storage;
}

/**
* Get DLQ storage
*/
export function getDLQStorage(): DLQStorage {
  return getDLQStorageInstance();
}

/**
* Sanitize error to prevent secret leakage

*/
function sanitizeError(error: Error): { message: string; stack?: string | undefined; code?: string | undefined } {
  // Patterns that might indicate sensitive data
  const sensitivePatterns = [
  /password[=:]\s*\S+/gi,
  /token[=:]\s*\S+/gi,
  /key[=:]\s*\S+/gi,
  /secret[=:]\s*\S+/gi,
  /auth[=:]\s*\S+/gi,
  /bearer\s+\S+/gi,
  /api[_-]?key[=:]?\s*\S+/gi,
  /[a-zA-Z0-9_]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, // email addresses
  /\b(?:[0-9]{1,3}\.){3}[0-9]{1,3}\b/g, // IP addresses
  ];

  let sanitizedMessage = error["message"];
  let sanitizedStack = error["stack"];

  for (const pattern of sensitivePatterns) {
  sanitizedMessage = sanitizedMessage.replace(pattern, '[REDACTED]');
  if (sanitizedStack) {
    sanitizedStack = sanitizedStack.replace(pattern, '[REDACTED]');
  }
  }

  // Truncate stack trace to first 10 lines to avoid excessive data exposure
  if (sanitizedStack) {
  const stackLines = sanitizedStack.split('\n');
  sanitizedStack = stackLines.slice(0, 10).join('\n');
  }

  return {
  message: sanitizedMessage,
  stack: sanitizedStack,
  code: (error as Error & { code?: string | undefined }).code,
  };
}

/**
* Send message to DLQ
* MEDIUM FIX M15
*/
/**
* Convert value to JSONValue (handles bigint serialization)
* @param value - Value to convert
* @returns JSONValue representation
*/
function toJSONValue(value: unknown): JSONValue {
  if (value === null || value === undefined) {
  return null;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
  return value;
  }
  if (typeof value === 'bigint') {
  return value.toString();
  }
  if (Array.isArray(value)) {
  return value.map(toJSONValue);
  }
  if (typeof value === 'object') {
  const result: Record<string, JSONValue> = {};
  for (const [k, v] of Object.entries(value)) {
    result[k] = toJSONValue(v);
  }
  return result;
  }
  // Functions, symbols, etc. become null
  return null;
}

export async function sendToDLQ(
  originalQueue: string,
  payload: unknown,
  error: Error,
  attempts: number,
  maxAttempts: number,
  metadata?: Record<string, unknown>
): Promise<void> {

  const sanitizedError = sanitizeError(error);

  const message: DLQMessage = {
  id: generateDLQId(),
  originalQueue,
  payload: toJSONValue(payload),
  error: sanitizedError,
  attempts,
  maxAttempts,
  failedAt: new Date().toISOString(),
  firstFailedAt: (metadata?.["firstFailedAt"] as string | undefined) || new Date().toISOString(),
  requestId: getRequestId(),
  };

  await getDLQStorageInstance().enqueue(message);
}

/**
* Generate unique DLQ message ID
*/
function generateDLQId(): string {
  return `dlq_${Date.now()}_${crypto.randomBytes(6).toString('hex')}`;
}

/**
* DLQ management functions
*/
export const DLQ = {
  async list(limit: number = 100): Promise<DLQMessage[]> {
  return getDLQStorageInstance().peek(limit);
  },

  async retry(id: string): Promise<void> {
  await getDLQStorageInstance().retry(id);
  },

  async remove(id: string): Promise<void> {
  await getDLQStorageInstance().delete(id);
  },

  async stats(): Promise<{ total: number }> {
  return { total: await getDLQStorageInstance().count() };
  },

  async purge(): Promise<void> {
  const storage = getDLQStorageInstance();
  const messages = await storage.peek(10000);
  for (const msg of messages) {
    await storage.delete(msg.id);
  }
  logger.info(`DLQ purged, removed ${messages.length} messages`);
  },
};

/**
* Wrap job handler with DLQ support
*/
export function withDLQ<T>(
  queueName: string,
  handler: (payload: T) => Promise<void>,
  options?: {
  maxAttempts?: number;
  onDLQ?: (message: DLQMessage) => void;
  }
): (payload: T, attempt?: number) => Promise<void> {
  const maxAttempts = options?.maxAttempts || 3;

  return async (payload: T, attempt: number = 1): Promise<void> => {
  try {
    await handler(payload);
  } catch (error: unknown) {
    if (attempt >= maxAttempts) {
    // Send to DLQ
    await sendToDLQ(
      'default-queue', // queue name - should be parameterized
      payload,
      error instanceof Error ? error : new Error(String(error)),
      attempt,
      maxAttempts,
      { firstFailedAt: new Date().toISOString() }
    );

    // Don't throw - message is now in DLQ
    return;
    }

    // Retry
    throw error;
  }
  };
}
