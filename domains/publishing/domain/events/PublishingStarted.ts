
import { DomainEventEnvelope } from '../../../../packages/types/domain-event';

export class PublishingStarted {
  toEnvelope(jobId: string, correlationId?: string): DomainEventEnvelope<{ jobId: string }> {
  return {
    name: 'publishing.started',
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: { jobId },
    meta: { correlationId: correlationId || '', domainId: 'publishing', source: 'domain' }
  };
  }
}
