
import { DomainEventEnvelope } from '../../../../packages/types/domain-event';

export class SearchIndexed {
  toEnvelope(contentId: string, correlationId?: string): DomainEventEnvelope<{ contentId: string }> {
  return {
    name: 'search.indexed',
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: { contentId },
    meta: { correlationId: correlationId || '', domainId: 'search', source: 'domain' }
  };
  }
}
