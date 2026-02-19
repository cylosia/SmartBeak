
import crypto from 'crypto';
import { DomainEventEnvelope, toIsoDateString } from '../../../../packages/types/domain-event';

export class SearchIndexFailed {
  toEnvelope(contentId: string, error: string, correlationId?: string): DomainEventEnvelope<string, { contentId: string; error: string }> {
  return {
    id: crypto.randomUUID(),
    name: 'search.index.failed',
    version: 1,
    occurredAt: toIsoDateString(new Date()),
    payload: { contentId, error },
    meta: { correlationId: correlationId || crypto.randomUUID(), domainId: 'search', source: 'domain' }
  };
  }
}
