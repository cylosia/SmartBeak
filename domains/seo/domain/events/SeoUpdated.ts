
import crypto from 'crypto';
import { DomainEventEnvelope, toIsoDateString } from '../../../../packages/types/domain-event';

export interface SeoUpdatedPayload {
  seoId: string;
}

export class SeoUpdated {
  toEnvelope(seoId: string, correlationId?: string): DomainEventEnvelope<string, SeoUpdatedPayload> {
  return {
    id: crypto.randomUUID(),
    name: 'seo.updated',
    version: 1,
    occurredAt: toIsoDateString(new Date()),
    payload: { seoId },
    meta: { correlationId: correlationId || crypto.randomUUID(), domainId: 'seo', source: 'domain' }
  };
  }
}
