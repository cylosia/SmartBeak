
// FIX(P2-CROSS-03): Use @types/* path alias instead of a fragile 4-level
// relative import that breaks on any directory restructuring.
import { DomainEventEnvelope, toIsoDateString } from '@types/domain-event';

export interface MediaUploadCompletedPayload {
  mediaId: string;
}

export class MediaUploadCompleted {
  // FIX(P0-EVTC-01): Supply BOTH type arguments to DomainEventEnvelope<TName, TPayload>.
  // DomainEventEnvelope requires two generic parameters (TName extends string, TPayload).
  // Passing only one argument was a hard TypeScript compile error that prevented the
  // entire event domain from type-checking. Providing the literal name type also
  // enables discriminated-union narrowing on event.name in switch handlers.
  // FIX(P2-EVTC-04): Use toIsoDateString() to produce the IsoDateString brand.
  // new Date().toISOString() returns plain `string`, which is not assignable to
  // the branded IsoDateString type declared on DomainEventEnvelope.occurredAt.
  toEnvelope(mediaId: string, correlationId?: string): DomainEventEnvelope<'media.upload.completed', MediaUploadCompletedPayload> {
  return {
    name: 'media.upload.completed',
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
