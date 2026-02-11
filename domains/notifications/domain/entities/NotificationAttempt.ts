/**
* NotificationAttempt - Immutable domain entity representing a delivery attempt
*/
export class NotificationAttempt {
  private constructor(
  public readonly id: string,
  public readonly notificationId: string,
  public readonly attemptNumber: number,
  public readonly status: 'success' | 'failure',
  public readonly error: string | undefined,
  public readonly createdAt: Date
  ) {}

  /**
  * Create a new notification attempt
  * @param id - Unique identifier
  * @param notificationId - Associated notification ID
  * @param attemptNumber - Attempt number (1-based)
  * @param status - Attempt status
  * @param error - Error message if failed
  * @param createdAt - Timestamp
  * @returns New NotificationAttempt instance
  */
  static create(
  id: string,
  notificationId: string,
  attemptNumber: number,
  status: 'success' | 'failure',
  error?: string,
  createdAt: Date = new Date()
  ): NotificationAttempt {
  if (attemptNumber < 1) {
    throw new Error('attemptNumber must be >= 1');
  }
  return new NotificationAttempt(id, notificationId, attemptNumber, status, error, createdAt);
  }

  /**
  * Reconstitute from persistence
  */
  static reconstitute(
  id: string,
  notificationId: string,
  attemptNumber: number,
  status: 'success' | 'failure',
  error: string | undefined,
  createdAt: Date
  ): NotificationAttempt {
  return new NotificationAttempt(id, notificationId, attemptNumber, status, error, createdAt);
  }

  /**
  * Create a successful attempt
  */
  static success(
  id: string,
  notificationId: string,
  attemptNumber: number
  ): NotificationAttempt {
  return NotificationAttempt.create(id, notificationId, attemptNumber, 'success');
  }

  /**
  * Create a failed attempt
  */
  static failure(
  id: string,
  notificationId: string,
  attemptNumber: number,
  error: string
  ): NotificationAttempt {
  return NotificationAttempt.create(id, notificationId, attemptNumber, 'failure', error);
  }

  /**
  * Check if attempt was successful
  */
  isSuccess(): boolean {
  return this["status"] === 'success';
  }

  /**
  * Check if attempt failed
  */
  isFailure(): boolean {
  return this["status"] === 'failure';
  }
}
