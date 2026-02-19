
import crypto from 'crypto';
import { DomainEventEnvelope, toIsoDateString } from '../../../../packages/types/domain-event';

export class PublishingFailed {
  toEnvelope(jobId: string, error: string, correlationId?: string): DomainEventEnvelope<string, { jobId: string; error: string }> {
  return {
    id: crypto.randomUUID(),
    name: 'publishing.failed',
    version: 1,
    occurredAt: toIsoDateString(new Date()),
    payload: { jobId, error },
    meta: { correlationId: correlationId || '', domainId: 'publishing', source: 'domain' }
  };
  }
}
