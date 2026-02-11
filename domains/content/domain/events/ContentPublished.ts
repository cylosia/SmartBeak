
import { CONTENT_PUBLISHED_V1, ContentPublishedV1Payload } from '../../../../packages/types/events/content-published.v1';
import { DomainEventEnvelope } from '../../../../packages/types/domain-event';

export class ContentPublished {
  toEnvelope(contentId: string): DomainEventEnvelope<ContentPublishedV1Payload> {
  return {
    name: CONTENT_PUBLISHED_V1["name"],
    version: CONTENT_PUBLISHED_V1.version,
    occurredAt: new Date().toISOString(),
    payload: { contentId },
    meta: { correlationId: '', domainId: 'content', source: 'domain' }
  };
  }
}
