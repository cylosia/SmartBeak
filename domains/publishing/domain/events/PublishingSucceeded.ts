
import { DomainEventEnvelope } from '../../../../packages/types/domain-event';

export class PublishingSucceeded {
  toEnvelope(jobId: string, correlationId?: string): DomainEventEnvelope<{ jobId: string }> {
  return {
    name: 'publishing.succeeded',
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: { jobId },
    meta: { correlationId: correlationId || '', domainId: 'publishing', source: 'domain' }
  };
  }
}
