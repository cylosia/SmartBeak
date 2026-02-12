

import { getLogger } from '@kernel/logger';

import { UsageService } from './usage';

export type Increment = { orgId: string; field: 'domain_count'|'content_count'|'media_count'|'publish_count'; by: number };

const DEFAULT_CONCURRENCY = 5;

// P1-FIX: Maximum buffer size to prevent unbounded memory growth
const MAX_BUFFER_SIZE = 10000;

export class UsageBatcher {
  private buffer: Increment[] = [];
  private timer: NodeJS.Timeout | undefined;
  private intervalTimer: NodeJS.Timeout | undefined;
  private flushing = false;
  private started = false;
  private readonly logger = getLogger('UsageBatcher');

  constructor(
  private usage: UsageService,
  private flushMs = 2000,
  private concurrency = DEFAULT_CONCURRENCY
  ) {}

  /**
  * P1-FIX: Start the efficient interval-based polling
  * This should be called once during initialization
  */
  start(): void {
  if (this.started) return;
  this.started = true;

  // P1-FIX: Use setInterval instead of recursive setTimeout for consistent timing
  this.intervalTimer = setInterval(() => {
    if (!this.flushing && this.buffer.length > 0) {
    // P1-FIX: Catch unhandled rejections from async flush() in setInterval callback
    this.flush().catch(err => this.logger.error('Flush failed in interval', err instanceof Error ? err : undefined));
    }
  }, this.flushMs);
  // P0-FIX: Add unref to prevent blocking graceful shutdown
  this.intervalTimer.unref();
  }

  /**
  * P1-FIX: Stop the polling interval
  */
  stop(): void {
  this.started = false;
  if (this.intervalTimer) {
    clearInterval(this.intervalTimer);
    this.intervalTimer = undefined;
  }
  if (this.timer) {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
  }

  add(inc: Increment) {
  if (!inc["orgId"] || typeof inc["orgId"] !== 'string') {
    throw new Error('Valid orgId is required');
  }

  // P1-FIX: Drop oldest items if buffer is at capacity (backpressure)
  // P1-FIX: Emit error-level log (not warn) so monitoring catches billing data loss
  if (this.buffer.length >= MAX_BUFFER_SIZE) {
    this.logger.error('BILLING_DATA_LOSS: Buffer at capacity, dropping oldest usage increment. Reconciliation required.');
    this.buffer.shift(); // Remove oldest
  }

  this.buffer.push(inc);

  // P1-FIX: Auto-start if not already started
  if (!this.started) {
    this.start();
  }

  // P1-FIX: Immediate flush if buffer is getting full (80% capacity)
  if (this.buffer.length >= MAX_BUFFER_SIZE * 0.8 && !this.flushing) {
    // P1-FIX: Catch unhandled rejections from async flush()
    this.flush().catch(err => this.logger.error('Flush failed in add()', err instanceof Error ? err : undefined));
  }
  }

  async flush(): Promise<void> {
  if (this.flushing || this.buffer.length === 0) {
    return;
  }

  this.flushing = true;
  const batch = this.buffer.splice(0, this.buffer.length);
  clearTimeout(this.timer);
  this.timer = undefined;

  try {
    await this.processBatchWithConcurrency(batch);
  } catch (error) {
    // P1-FIX: Only re-queue items if we have room (prevent unbounded growth)
    const availableSpace = MAX_BUFFER_SIZE - this.buffer.length;
    if (availableSpace > 0) {
    const toRequeue = batch.slice(0, availableSpace);
    this.buffer.unshift(...toRequeue);
    }
    this.logger.error(
    'Flush failed, items re-queued',
    error instanceof Error ? error : undefined,
    {
    batchSize: batch.length,
    bufferSize: this.buffer.length,
    requeued: Math.min(batch.length, availableSpace),
    }
    );
  } finally {
    this.flushing = false;
  }
  }

  /**
  * Process batch with concurrency limit
  */
  private async processBatchWithConcurrency(batch: Increment[]): Promise<void> {
  const _results: Promise<void>[] = [];
  const errors: Error[] = [];

  // Process in chunks to limit concurrency
  for (let i = 0; i < batch.length; i += this.concurrency) {
    const chunk = batch.slice(i, i + this.concurrency);

    const chunkPromises = chunk.map(async (inc) => {
    try {
    await this.usage.increment(inc["orgId"], inc.field, inc.by);
    } catch (error) {
    errors.push(error instanceof Error ? error : new Error(String(error)));
    }
    });

    await Promise.all(chunkPromises);
  }

  if (errors.length > 0) {
    throw new Error(`Batch processing failed with ${errors.length} errors: ${errors[0]!.message}`);
  }
  }

  /**
  * Get current buffer size
  */
  getBufferSize(): number {
  return this.buffer.length;
  }

  /**
  * Check if currently flushing
  */
  isFlushing(): boolean {
  return this.flushing;
  }

  /**
  * Dispose and flush remaining items
  */
  async dispose(): Promise<void> {
  this.stop();
  await this.flush();
  }
}
