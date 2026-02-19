
import crypto from 'crypto';
import { DomainEventEnvelope, toIsoDateString } from '../../../../packages/types/domain-event';

export class PublishingStarted {
  toEnvelope(jobId: string, correlationId?: string): DomainEventEnvelope<string, { jobId: string }> {
  return {
    id: crypto.randomUUID(),
    name: 'publishing.started',
    version: 1,
    occurredAt: toIsoDateString(new Date()),
    payload: { jobId },
    meta: { correlationId: correlationId || '', domainId: 'publishing', source: 'domain' }
  };
  }
}
