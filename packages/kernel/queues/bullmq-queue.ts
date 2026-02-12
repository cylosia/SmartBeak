
import { DomainEventEnvelope } from '@packages/types';
import { Queue } from 'bullmq';

// P0-FIX: Parse Redis connection from REDIS_URL. Without this, BullMQ defaults
// to localhost:6379 which silently fails in production/Vercel environments.
// This matches the connection parsing logic in bullmq-worker.ts.
function getRedisConnection(): { host: string; port: number; password?: string; tls?: { rejectUnauthorized: boolean } } {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    throw new Error('REDIS_URL environment variable is required for BullMQ queue');
  }

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function enqueueEvent(event: DomainEventEnvelope<any>) {
  await eventQueue.add(event.name, event, { attempts: 3 });
}
