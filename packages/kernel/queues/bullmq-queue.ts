
import { EventEmitter } from 'events';
import { DomainEventEnvelope } from '@packages/types/domain-event';
import { Queue } from 'bullmq';
import { getLogger } from '@kernel/logger';

const logger = getLogger('bullmq');

// P0-FIX: Parse Redis connection from REDIS_URL. Without this, BullMQ defaults
// to localhost:6379 which silently fails in production/Vercel environments.
// This matches the connection parsing logic in bullmq-worker.ts.
function getRedisConnection(): { host: string; port: number; password?: string; tls?: { rejectUnauthorized: boolean } } {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is required for BullMQ queue');
  }

  const url = new URL(redisUrl);
  const parsedPort = parseInt(url.port || '6379', 10);
  if (isNaN(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    throw new Error(`Invalid Redis port in REDIS_URL: ${url.port}`);
  }

  let password: string | undefined;
  if (url.password) {
    try {
      password = decodeURIComponent(url.password);
    } catch (_e) {
      throw new Error('REDIS_URL contains an invalid percent-encoded password');
    }
  }

  return {
    host: url.hostname,
    port: parsedPort,
    ...(password && { password }),
    ...(url.protocol === 'rediss:' && { tls: { rejectUnauthorized: true } }),
  };
}

// P1-FIX (P1-1): Validate the Redis connection is reachable before the queue
// is created. Without this, the Queue object is constructed successfully but
// every job enqueue silently fails until the first I/O error is emitted —
// by which time the process has started serving traffic with a dead queue.
async function validateRedisConnection(conn: ReturnType<typeof getRedisConnection>): Promise<void> {
  // BullMQ already depends on ioredis, so import it directly.
  const { default: Redis } = await import('ioredis');
  const client = new Redis(conn);
  try {
    await client.ping();
  } finally {
    client.disconnect();
  }
}

const _redisConn = getRedisConnection();
// Top-level await is valid in ESM modules (this package uses "type": "module").
// This will throw at startup if Redis is unreachable, preventing silent job loss.
await validateRedisConnection(_redisConn);

export const eventQueue = new Queue('events', {
  connection: _redisConn,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2_000 },
    // P3-FIX: Retain completed jobs for 24 h in addition to capping by count.
    // Count-only retention means high-throughput periods evict jobs in minutes,
    // destroying the ability to correlate queue job IDs with audit_events rows
    // during incident postmortems. The 24 h age limit bounds Redis memory while
    // keeping a useful window for investigations.
    removeOnComplete: { count: 1_000, age: 86_400 },
    // P1-FIX: Bound failed-job retention. removeOnFail: false kept all failed jobs
    // in Redis permanently — under sustained downstream failures this exhausts Redis
    // memory, eventually making the queue unavailable. Retain the 5 000 most recent
    // failures for post-mortem debugging while bounding memory usage.
    removeOnFail: { count: 5_000 },
  },
});

// P1-FIX: Handle the 'error' event on the Queue instance. In Node.js, an
// EventEmitter with no 'error' listener throws synchronously, crashing the
// process. Redis disconnects, TLS errors, and serialization failures all emit
// this event. Without a handler, any Redis blip kills the application.
eventQueue.on('error', (err) => {
  logger.error('BullMQ queue error', err instanceof Error ? err : undefined);
});

// BullMQ v5: 'failed' and 'stalled' events are on QueueEvents, not Queue.
// Use EventEmitter cast for backward-compatible runtime listeners.
(eventQueue as unknown as EventEmitter).on('failed', (job: unknown, err: unknown) => {
  const typedJob = job as { id?: string; name?: string } | undefined;
  logger.error('Job permanently failed', err instanceof Error ? err : undefined, {
    jobId: typedJob?.id,
    jobName: typedJob?.name,
  });
});

(eventQueue as unknown as EventEmitter).on('stalled', (jobId: unknown) => {
  logger.warn('Job stalled', { jobId: String(jobId) });
});

export async function enqueueEvent(event: DomainEventEnvelope<string, unknown>) {
  // P1-FIX: Derive a deterministic job ID from the event envelope's identity fields
  // so that BullMQ deduplicates retries. Without a jobId, every call to enqueueEvent
  // created a new random job — duplicate enqueues (HTTP retries, at-least-once
  // delivery) produced duplicate jobs, each processed independently, double-counting
  // financial KPIs and publish intents.
  const jobId = `${event.meta.domainId}:${event.meta.correlationId}`;
  await eventQueue.add(event.name, event, { jobId });
}
