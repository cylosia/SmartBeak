
import { DomainEventEnvelope } from '../../../../packages/types/domain-event';

export interface SeoUpdatedPayload {
  seoId: string;
}

export class SeoUpdated {
  toEnvelope(seoId: string, correlationId?: string): DomainEventEnvelope<SeoUpdatedPayload> {
  return {
    name: 'seo.updated',
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: { seoId },
    meta: { correlationId: correlationId || '', domainId: 'seo', source: 'domain' }
  };
  }
}
