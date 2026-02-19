
import crypto from 'crypto';
import { DomainEventEnvelope, toIsoDateString } from '../../../../packages/types/domain-event';

export class SearchIndexed {
  toEnvelope(contentId: string, correlationId?: string): DomainEventEnvelope<string, { contentId: string }> {
  return {
    id: crypto.randomUUID(),
    name: 'search.indexed',
    version: 1,
    occurredAt: toIsoDateString(new Date()),
    payload: { contentId },
    // Generate a UUID when no correlationId is supplied so distributed tracing
    // always has a non-empty identifier to follow across service boundaries.
    meta: { correlationId: correlationId || crypto.randomUUID(), domainId: 'search', source: 'domain' }
  };
  }
}
