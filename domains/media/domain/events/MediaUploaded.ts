
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
    meta: { correlationId: correlationId || '', domainId: 'media', source: 'domain' }
  };
  }
}
