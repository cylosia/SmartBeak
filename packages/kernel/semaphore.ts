import { getLogger } from './logger';

const logger = getLogger('semaphore');

/**
 * Async semaphore for backpressure and concurrency control.
 *
 * Limits concurrent access to a resource by requiring callers to acquire
 * a permit before proceeding. When all permits are in use, callers wait
 * in a FIFO queue with optional timeout and AbortSignal support.
 */
export class Semaphore {
  private permits: number;
  private readonly maxPermits: number;
  private readonly waitQueue: Array<{
    resolve: () => void;
    reject: (err: Error) => void;
    timeoutId?: NodeJS.Timeout;
    onAbort?: () => void;
    signal?: AbortSignal;
  }> = [];

  constructor(maxPermits: number) {
    if (maxPermits < 1) throw new Error('maxPermits must be >= 1');
    this.maxPermits = maxPermits;
    this.permits = maxPermits;
  }

  /**
   * Try to acquire a permit without waiting.
   * @returns true if a permit was acquired, false if none available
   */
  tryAcquire(): boolean {
    if (this.permits > 0) {
      this.permits--;
      return true;
    }
    return false;
  }

  /**
   * Acquire a permit, waiting up to timeoutMs if necessary.
   * @param timeoutMs - Maximum time to wait (undefined = wait indefinitely)
   * @param signal - Optional AbortSignal to cancel the wait
   * @throws Error if timeout or signal fires before permit is available
   */
  async acquire(timeoutMs?: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('Semaphore acquire aborted');

    if (this.permits > 0) {
      this.permits--;
      return;
    }

    return new Promise<void>((resolve, reject) => {
      const entry: typeof this.waitQueue[number] = {
        resolve: () => { cleanup(); resolve(); },
        reject: (err: Error) => { cleanup(); reject(err); },
      };

      const cleanup = () => {
        if (entry.timeoutId) clearTimeout(entry.timeoutId);
        if (entry.onAbort && entry.signal) {
          entry.signal.removeEventListener('abort', entry.onAbort);
        }
        const idx = this.waitQueue.indexOf(entry);
        if (idx >= 0) this.waitQueue.splice(idx, 1);
      };

      if (timeoutMs !== undefined) {
        entry.timeoutId = setTimeout(() => {
          entry.reject(new Error(`Semaphore acquire timeout after ${timeoutMs}ms`));
        }, timeoutMs);
      }

      if (signal) {
        entry.signal = signal;
        entry.onAbort = () => entry.reject(new Error('Semaphore acquire aborted'));
        signal.addEventListener('abort', entry.onAbort, { once: true });
      }

      this.waitQueue.push(entry);
    });
  }

  /**
   * Release a permit. If waiters are queued, the next one is woken.
   */
  release(): void {
    if (this.waitQueue.length > 0) {
      const next = this.waitQueue.shift()!;
      // Hand permit directly to the waiter (don't increment permits)
      next.resolve();
    } else {
      this.permits = Math.min(this.permits + 1, this.maxPermits);
    }
  }

  /** Current available permits */
  get available(): number { return this.permits; }

  /** Current number of waiters in the queue */
  get waiting(): number { return this.waitQueue.length; }

  /** Maximum permits configured */
  get max(): number { return this.maxPermits; }
}

/**
 * Error thrown when a pool or resource is exhausted and
 * backpressure prevents the request from proceeding.
 */
export class PoolExhaustionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PoolExhaustionError';
  }
}

/**
 * Error thrown when a job queue has too many pending items
 * and backpressure prevents enqueuing more.
 */
export class QueueBackpressureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueueBackpressureError';
  }
}
