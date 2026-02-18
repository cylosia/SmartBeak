
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

export const eventQueue = new Queue('events', {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2_000 },
    removeOnComplete: { count: 1_000 },
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
  logger.error('BullMQ queue error', { err });
});

eventQueue.on('failed', (job, err) => {
  logger.error('Job permanently failed', {
    jobId: job?.id,
    jobName: job?.name,
    err,
  });
});

eventQueue.on('stalled', (jobId) => {
  logger.warn('Job stalled', { jobId });
});

export async function enqueueEvent(event: DomainEventEnvelope<unknown>) {
  await eventQueue.add(event.name, event);
}
