
import { DomainEventEnvelope } from '@packages/types/domain-event';
import { Queue } from 'bullmq';

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
});

export async function enqueueEvent(event: DomainEventEnvelope<unknown>) {
  await eventQueue.add(event.name, event, { attempts: 3 });
}
