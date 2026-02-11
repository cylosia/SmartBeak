/**
* Notification Domain Entity
*
* Represents a notification with a state machine for delivery tracking.
* Notifications follow the lifecycle: pending → sending → delivered/failed.
*
* This entity is immutable - all state changes return new instances.
*
* @module domains/notifications/domain/entities/Notification
*/

export type NotificationStatus = 'pending' | 'sending' | 'delivered' | 'failed';

export interface NotificationPayload {
  to?: string;
  subject?: string;
  body?: string;
  data?: Record<string, unknown>;
  [key: string]: unknown;
}

// Valid state transitions
const VALID_TRANSITIONS: Record<NotificationStatus, NotificationStatus[]> = {
  pending: ['sending'],
  sending: ['delivered', 'failed'],
  delivered: [], // Terminal state
  failed: ['pending'], // Allow retry
};

/**
* Notification - Immutable domain entity with state machine validation
*
* State transitions:
*   pending → sending → delivered
*                   ↘ failed → pending (retry)
*/
export class Notification {
  private static readonly VALID_TRANSITIONS = VALID_TRANSITIONS;

  private constructor(
  public readonly id: string,
  public readonly orgId: string,
  public readonly userId: string,
  public readonly channel: string,
  public readonly template: string,
  public readonly payload: NotificationPayload,
  public readonly status: NotificationStatus
  ) {}

  /**
  * Create a new notification
  * @param id - Unique identifier
  * @param orgId - Organization ID
  * @param userId - User ID
  * @param channel - Delivery channel
  * @param template - Template name
  * @param payload - Notification payload
  * @param status - Initial status
  * @returns New Notification instance
  */
  static create(
  id: string,
  orgId: string,
  userId: string,
  channel: string,
  template: string,
  payload: NotificationPayload,
  status: NotificationStatus = 'pending'
  ): Notification {
  if (status !== 'pending') {
    throw new Error('Initial status must be pending');
  }
  return new Notification(id, orgId, userId, channel, template, payload, status);
  }

  /**
  * Reconstitute from persistence
  */
  static reconstitute(
  id: string,
  orgId: string,
  userId: string,
  channel: string,
  template: string,
  payload: NotificationPayload,
  status: NotificationStatus
  ): Notification {
  return new Notification(id, orgId, userId, channel, template, payload, status);
  }

  private validateTransition(to: NotificationStatus): void {
  const validTransitions = Notification.VALID_TRANSITIONS[this["status"]];
  if (!validTransitions.includes(to)) {
    throw new Error(
    `Invalid state transition: cannot transition from '${this["status"]}' to '${to}'. ` +
    `Valid transitions from '${this["status"]}' are: ${validTransitions.join(', ') || 'none'}`
    );
  }
  }

  /**
  * Start sending - returns new immutable instance
  * @returns New Notification with 'sending' status
  */
  start(): Notification {
  this.validateTransition('sending');
  return new Notification(
    this["id"],
    this["orgId"],
    this.userId,
    this.channel,
    this.template,
    this.payload,
    'sending'
  );
  }

  /**
  * Mark as delivered - returns new immutable instance
  * @returns New Notification with 'delivered' status
  */
  succeed(): Notification {
  this.validateTransition('delivered');
  return new Notification(
    this["id"],
    this["orgId"],
    this.userId,
    this.channel,
    this.template,
    this.payload,
    'delivered'
  );
  }

  /**
  * Mark as failed - returns new immutable instance
  * @returns New Notification with 'failed' status
  */
  fail(): Notification {
  this.validateTransition('failed');
  return new Notification(
    this["id"],
    this["orgId"],
    this.userId,
    this.channel,
    this.template,
    this.payload,
    'failed'
  );
  }

  /**
  * Check if notification can be retried
  */
  canRetry(): boolean {
  return this["status"] === 'failed' || this["status"] === 'pending';
  }

  /**
  * Check if notification is in terminal state
  */
  isTerminal(): boolean {
  return this["status"] === 'delivered';
  }

  /**
  * Check if notification is pending
  */
  isPending(): boolean {
  return this["status"] === 'pending';
  }

  /**
  * Check if notification is being sent
  */
  isSending(): boolean {
  return this["status"] === 'sending';
  }
}
