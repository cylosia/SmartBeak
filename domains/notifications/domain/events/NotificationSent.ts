
import { DomainEventEnvelope } from '../../../../packages/types/domain-event';

export class NotificationSent {
  toEnvelope(notificationId: string, correlationId?: string): DomainEventEnvelope<{ notificationId: string }> {
  return {
    name: 'notification.sent',
    version: 1,
    occurredAt: new Date().toISOString(),
    payload: { notificationId },
    meta: { correlationId: correlationId || '', domainId: 'notifications', source: 'domain' }
  };
  }
}
