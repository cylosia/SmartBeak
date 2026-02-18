
// FIX(P2-CROSS-03): Use @types/* path alias instead of a fragile 4-level relative import.
import { DomainEventEnvelope, toIsoDateString } from '@types/domain-event';

export interface MediaUploadedPayload {
  mediaId: string;
}

export class MediaUploaded {
  // FIX(P0-EVTU-01): Supply BOTH type arguments to DomainEventEnvelope<TName, TPayload>.
  // Same compile error as MediaUploadCompleted — one-arg usage of a two-arg generic.
  // FIX(P2-EVTU-03): Use toIsoDateString() for the branded IsoDateString occurredAt field.
  toEnvelope(mediaId: string, correlationId?: string): DomainEventEnvelope<'media.uploaded', MediaUploadedPayload> {
  return {
    name: 'media.uploaded',
    version: 1,
    occurredAt: toIsoDateString(new Date()),
    payload: { mediaId },
    // FIX(P1): Use a generated UUID fallback instead of '' — empty string clusters
    // ALL uncorrelated events under the same key in distributed tracing systems,
    // making incident investigation impossible.
    meta: { correlationId: correlationId ?? crypto.randomUUID(), domainId: 'media', source: 'domain' }
  };
  }
}
