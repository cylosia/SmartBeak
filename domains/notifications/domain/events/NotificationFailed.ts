
import { randomUUID } from 'crypto';
import { DomainEventEnvelope, toIsoDateString } from '../../../../packages/types/domain-event';

export class NotificationFailed {
  // EVT-FIX: Full generic signature so TypeScript can narrow `name` in discriminated
  // unions. Previously the missing TName caused every switch(event.name) handler to
  // treat 'notification.failed' as an unreachable branch, hiding unhandled event bugs.
  // EVT-3-FIX: id field added for idempotency/deduplication of redelivered events.
  // EVT-1-FIX: toIsoDateString() enforces the IsoDateString brand; plain toISOString()
  // returned a string type and bypassed the branded type guard.
  toEnvelope(notificationId: string, error: string, correlationId?: string): DomainEventEnvelope<'notification.failed', { notificationId: string; error: string }> {
  return {
    id: randomUUID(),
    name: 'notification.failed',
    version: 1,
    occurredAt: toIsoDateString(new Date()),
    payload: { notificationId, error },
    meta: { correlationId: correlationId || '', domainId: 'notifications', source: 'domain' }
  };
  }
}
