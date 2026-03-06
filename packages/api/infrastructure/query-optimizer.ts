/**
 * SmartBeak Phase 3A — Query Optimization Utilities
 *
 * Provides:
 * - Cursor-based pagination (more efficient than OFFSET for large datasets)
 * - Batch data loader factory (prevents N+1 queries)
 * - Query timing instrumentation for performance monitoring
 * - Connection pool health check
 */

import { db } from "@repo/database";
import { logger } from "@repo/logs";

// ─── Cursor-based pagination ───────────────────────────────────────────────────

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

/**
 * Encodes a cursor from a date and UUID for stable pagination.
 * Format: base64(ISO_DATE:UUID)
 */
export function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(`${createdAt.toISOString()}:${id}`).toString("base64url");
}

/**
 * Decodes a cursor back into its component parts.
 */
export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const decoded = Buffer.from(cursor, "base64url").toString("utf8");
  const colonIdx = decoded.indexOf(":");
  return {
    createdAt: new Date(decoded.slice(0, colonIdx)),
    id: decoded.slice(colonIdx + 1),
  };
}

// ─── Batch DataLoader ─────────────────────────────────────────────────────────

type BatchLoadFn<K, V> = (keys: K[]) => Promise<Map<K, V>>;

/**
 * Creates a simple batching data loader that coalesces multiple individual
 * lookups into a single batch query within the same event loop tick.
 *
 * This prevents the N+1 query problem when resolving nested data
 * (e.g., loading user profiles for each team member).
 */
export function createBatchLoader<K, V>(
  batchFn: BatchLoadFn<K, V>,
  options: { maxBatchSize?: number } = {},
): (key: K) => Promise<V | null> {
  const maxBatchSize = options.maxBatchSize ?? 100;
  let batch: { key: K; resolve: (v: V | null) => void; reject: (e: unknown) => void }[] = [];
  let scheduled = false;

  const dispatch = async () => {
    const currentBatch = batch.splice(0, maxBatchSize);
    scheduled = false;

    if (currentBatch.length === 0) return;

    try {
      const keys = currentBatch.map((b) => b.key);
      const results = await batchFn(keys);
      for (const { key, resolve } of currentBatch) {
        resolve(results.get(key) ?? null);
      }
    } catch (err) {
      for (const { reject } of currentBatch) {
        reject(err);
      }
    }
  };

  return (key: K): Promise<V | null> => {
    return new Promise((resolve, reject) => {
      batch.push({ key, resolve, reject });
      if (!scheduled) {
        scheduled = true;
        // Schedule dispatch on next microtask tick.
        Promise.resolve().then(dispatch);
      }
    });
  };
}

// ─── Query timing instrumentation ─────────────────────────────────────────────

/**
 * Wraps a database query function with timing instrumentation.
 * Logs slow queries (> 500ms) to the console in development.
 */
export async function timedQuery<T>(
  label: string,
  fn: () => Promise<T>,
  slowThresholdMs = 500,
): Promise<T> {
  const start = performance.now();
  try {
    const result = await fn();
    const elapsed = performance.now() - start;
    if (elapsed > slowThresholdMs && process.env.NODE_ENV !== "production") {
      logger.warn(
        `[SlowQuery] "${label}" took ${elapsed.toFixed(1)}ms (threshold: ${slowThresholdMs}ms)`,
      );
    }
    return result;
  } catch (err) {
    const elapsed = performance.now() - start;
    if (process.env.NODE_ENV !== "production") {
      logger.error(`[QueryError] "${label}" failed after ${elapsed.toFixed(1)}ms:`, err);
    }
    throw err;
  }
}

// ─── Connection pool health ───────────────────────────────────────────────────

/**
 * Checks database connectivity and returns latency in milliseconds.
 * Used by the /api/health endpoint.
 */
export async function checkDatabaseHealth(): Promise<{
  healthy: boolean;
  latencyMs: number;
  error?: string;
}> {
  const start = performance.now();
  try {
    await db.$queryRawUnsafe("SELECT 1");
    return { healthy: true, latencyMs: Math.round(performance.now() - start) };
  } catch (err) {
    return {
      healthy: false,
      latencyMs: Math.round(performance.now() - start),
      error: (err as Error).message,
    };
  }
}

// ─── Pagination helpers ───────────────────────────────────────────────────────

/**
 * Builds a standard paginated response object.
 */
export function buildPage<T extends { id: string; createdAt: Date }>(
  items: T[],
  requestedLimit: number,
): CursorPage<T> {
  const hasMore = items.length > requestedLimit;
  const pageItems = hasMore ? items.slice(0, requestedLimit) : items;
  const lastItem = pageItems[pageItems.length - 1];

  return {
    items: pageItems,
    hasMore,
    nextCursor:
      hasMore && lastItem
        ? encodeCursor(lastItem.createdAt, lastItem.id)
        : null,
  };
}
