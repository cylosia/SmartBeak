
import crypto from 'crypto';
import { DomainEventEnvelope, toIsoDateString } from '../../../../packages/types/domain-event';

export interface ContentScheduledPayload {
  contentId: string;
  publishAt: string;
}

export class ContentScheduled {
  toEnvelope(contentId: string, publishAt: Date, correlationId = crypto.randomUUID()): DomainEventEnvelope<string, ContentScheduledPayload> {
  return {
    id: crypto.randomUUID(),
    name: 'content.scheduled',
    version: 1,
    occurredAt: toIsoDateString(new Date()),
    payload: { contentId, publishAt: publishAt.toISOString() },
    meta: { correlationId, domainId: 'content', source: 'domain' }
  };
  }
}
