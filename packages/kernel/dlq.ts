

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
  // DLQ-6-FIX P1: Returns true if the message was found and its callback invoked,
  // false if no message or no callback exists. Callers can no longer silently
  // ignore a no-op retry on a non-existent or callback-less message.
  retry(id: string): Promise<boolean>;
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
    // DLQ-3-FIX P1: Scan oldest-first for an entry without an active retry callback.
    // The previous code skipped eviction when the OLDEST entry had an active retry but
    // still enqueued the new message, allowing the map to grow unboundedly past MAX_SIZE.
    let evictedKey: string | undefined;
    for (const key of this.messages.keys()) {
      if (!this.retryCallbacks.has(key)) {
        evictedKey = key;
        break;
      }
    }
    if (evictedKey) {
      this.messages.delete(evictedKey);
      this.timestamps.delete(evictedKey);
      logger.warn('DLQ size limit reached, removed oldest evictable message', {
        removedId: evictedKey,
        currentSize: this.messages.size,
      });
    } else {
      // All existing messages have active retry callbacks — drop the incoming message
      // rather than silently exceeding MAX_SIZE and breaking the bounded-queue guarantee.
      logger.error('DLQ size limit reached; all entries have active retries — dropping new message', {
        droppedId: message.id,
        currentSize: this.messages.size,
      });
      return;
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
    // BUG-DLQ-01 fix: also remove the associated timestamp and retry callback so
    // they are not retained for up to 7 days (until the hourly cleanup TTLs them out).
    this.timestamps.delete(id);
    this.retryCallbacks.delete(id);
  }
  return message || null;
  }

  async peek(limit: number): Promise<DLQMessage[]> {
  // P2-FIX: Pre-compute timestamps before sort. The old comparator created a new Date
  // on every comparison call — O(n log n) Date constructions. For 10,000 entries this
  // created ~130,000 Date objects and spiked GC on every DLQ management operation.
  const withTs = [...this.messages.values()].map(m => ({ m, t: Date.parse(m.failedAt) }));
  withTs.sort((a, b) => b.t - a.t);
  return withTs.slice(0, limit).map(x => x.m);
  }

  async delete(id: string): Promise<void> {
  this.messages.delete(id);
  this.retryCallbacks.delete(id);
  // BUG-DLQ-02 fix: timestamps was not cleaned up here, causing it to grow
  // unboundedly across purge cycles (up to 10,000 stale entries for 7 days).
  this.timestamps.delete(id);
  }

  async retry(id: string): Promise<boolean> {
  const callback = this.retryCallbacks.get(id);
  // DLQ-6-FIX P1: Return false when no callback registered instead of no-oping silently.
  if (!callback) {
    return false;
  }
  await callback();
  await this.delete(id);
  return true;
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
  /\b[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\b/g, // IPv4 addresses (unrolled to avoid ReDoS)
  // DLQ-7-FIX P2: Add IPv6 address redaction — previously only IPv4 was redacted.
  /(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}/g, // IPv6 addresses
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
// BUG-DLQ-03 fix: return the DLQMessage so callers (e.g. withDLQ) can invoke onDLQ.
): Promise<DLQMessage> {

  const sanitizedError = sanitizeError(error);

  // P2-FIX: Persist all metadata keys (not just firstFailedAt) so correlation IDs,
  // user context, and job parameters are available for DLQ investigation. Previously
  // every key in `metadata` except firstFailedAt was silently dropped.
  // BUG-DLQ-07 fix: validate that firstFailedAt is actually a string before using it;
  // `as string | undefined` was an unsafe cast on an `unknown` value.
  const rawFirstFailedAt = metadata?.["firstFailedAt"];
  const firstFailedAtValue = typeof rawFirstFailedAt === 'string' ? rawFirstFailedAt : undefined;
  let serializedMeta: Record<string, JSONValue> | undefined;
  if (metadata) {
  const { firstFailedAt: _ignored, ...rest } = metadata;
  const entries = Object.entries(rest);
  if (entries.length > 0) {
    serializedMeta = {};
    for (const [k, v] of entries) {
    serializedMeta[k] = toJSONValue(v);
    }
  }
  }

  const message: DLQMessage = {
  id: generateDLQId(),
  originalQueue,
  payload: toJSONValue(payload),
  error: sanitizedError,
  attempts,
  maxAttempts,
  failedAt: new Date().toISOString(),
  firstFailedAt: firstFailedAtValue || new Date().toISOString(),
  requestId: getRequestId(),
  ...(serializedMeta !== undefined ? { metadata: serializedMeta } : {}),
  };

  await getDLQStorageInstance().enqueue(message);
  return message;
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

  async retry(id: string): Promise<boolean> {
  return getDLQStorageInstance().retry(id);
  },

  async remove(id: string): Promise<void> {
  await getDLQStorageInstance().delete(id);
  },

  async stats(): Promise<{ total: number }> {
  return { total: await getDLQStorageInstance().count() };
  },

  // P2-14 FIX: Batch deletion instead of serial one-by-one to avoid blocking event loop
  async purge(): Promise<void> {
  const storage = getDLQStorageInstance();
  const messages = await storage.peek(10000);
  const BATCH_SIZE = 100;
  for (let i = 0; i < messages.length; i += BATCH_SIZE) {
    const batch = messages.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(msg => storage.delete(msg.id)));
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
  // BUG-DLQ-04 fix: use ?? instead of || so maxAttempts: 0 (send to DLQ immediately)
  // is respected rather than being coerced to 3 by the falsy || operator.
  const maxAttempts = options?.maxAttempts ?? 3;

  return async (payload: T, attempt: number = 1): Promise<void> => {
  try {
    await handler(payload);
  } catch (error: unknown) {
    if (attempt >= maxAttempts) {
    // Send to DLQ
    // BUG-DLQ-03 fix: capture the returned DLQMessage so onDLQ can be invoked.
    const dlqMessage = await sendToDLQ(
      queueName, // H10-FIX: Use actual queue name parameter instead of hardcoded value
      payload,
      error instanceof Error ? error : new Error(String(error)),
      attempt,
      maxAttempts,
      { firstFailedAt: new Date().toISOString() }
    );

    options?.onDLQ?.(dlqMessage);

    // Don't throw - message is now in DLQ
    return;
    }

    // Retry
    throw error;
  }
  };
}
