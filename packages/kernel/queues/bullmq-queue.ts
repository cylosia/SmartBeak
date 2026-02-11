
import { DomainEventEnvelope } from '@packages/types';
import { Queue } from 'bullmq';

export const eventQueue = new Queue('events');

export async function enqueueEvent(event: DomainEventEnvelope<any>) {
  await eventQueue.add(event.name, event, { attempts: 3 });
}
