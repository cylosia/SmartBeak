
import { DomainEventEnvelope } from '../../../../packages/types/domain-event';

export interface MediaUploadCompletedPayload {
  mediaId: string;
}

export class MediaUploadCompleted {
  toEnvelope(mediaId: string, correlationId?: string): DomainEventEnvelope<MediaUploadCompletedPayload> {
  return {
    name: 'media.upload.completed',
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: { mediaId },
    meta: { correlationId: correlationId || '', domainId: 'media', source: 'domain' }
  };
  }
}
