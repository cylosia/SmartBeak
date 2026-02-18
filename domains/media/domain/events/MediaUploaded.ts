
import { DomainEventEnvelope } from '../../../../packages/types/domain-event';

export interface MediaUploadedPayload {
  mediaId: string;
}

export class MediaUploaded {
  toEnvelope(mediaId: string, correlationId?: string): DomainEventEnvelope<MediaUploadedPayload> {
  return {
    name: 'media.uploaded',
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: { mediaId },
    // FIX(P1): Use a generated UUID fallback instead of '' — empty string clusters
    // ALL uncorrelated events under the same key in distributed tracing systems,
    // making incident investigation impossible.
    meta: { correlationId: correlationId ?? crypto.randomUUID(), domainId: 'media', source: 'domain' }
  };
  }
}
