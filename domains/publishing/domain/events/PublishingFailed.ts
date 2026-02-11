
import { DomainEventEnvelope } from '../../../../packages/types/domain-event';

export class PublishingFailed {
  toEnvelope(jobId: string, error: string, correlationId?: string): DomainEventEnvelope<{ jobId: string; error: string }> {
  return {
    name: 'publishing.failed',
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: { jobId, error },
    meta: { correlationId: correlationId || '', domainId: 'publishing', source: 'domain' }
  };
  }
}
