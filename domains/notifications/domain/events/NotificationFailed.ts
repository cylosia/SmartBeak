
import { DomainEventEnvelope } from '../../../../packages/types/domain-event';

export class NotificationFailed {
  toEnvelope(notificationId: string, error: string, correlationId?: string): DomainEventEnvelope<{ notificationId: string; error: string }> {
  return {
    name: 'notification.failed',
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: { notificationId, error },
    meta: { correlationId: correlationId || '', domainId: 'notifications', source: 'domain' }
  };
  }
}
