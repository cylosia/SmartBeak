
import { DomainEventEnvelope } from '../../../../packages/types/domain-event';

export class SearchIndexFailed {
  toEnvelope(contentId: string, error: string, correlationId?: string): DomainEventEnvelope<{ contentId: string; error: string }> {
  return {
    name: 'search.index.failed',
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: { contentId, error },
    meta: { correlationId: correlationId || '', domainId: 'search', source: 'domain' }
  };
  }
}
