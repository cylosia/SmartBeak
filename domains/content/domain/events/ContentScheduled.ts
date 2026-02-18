
import crypto from 'crypto';
import { DomainEventEnvelope } from '../../../../packages/types/domain-event';

export interface ContentScheduledPayload {
  contentId: string;
  publishAt: string;
}

export class ContentScheduled {
  toEnvelope(contentId: string, publishAt: Date, correlationId = crypto.randomUUID()): DomainEventEnvelope<ContentScheduledPayload> {
  return {
    name: 'content.scheduled',
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: { contentId, publishAt: publishAt.toISOString() },
    meta: { correlationId, domainId: 'content', source: 'domain' }
  };
  }
}
