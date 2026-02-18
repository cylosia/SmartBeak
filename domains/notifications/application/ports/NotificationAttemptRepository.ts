import { PoolClient } from 'pg';

/**
 * Port interface for NotificationAttempt persistence.
 *
 * Defines the contract for recording and querying notification delivery attempts.
 * Application layer code must depend on this interface, not on concrete
 * infrastructure implementations.
 */
export interface NotificationAttemptRepository {
  /**
   * Record a delivery attempt for a notification.
   *
   * @param notificationId - ID of the notification
   * @param attempt - Attempt number (1-based)
   * @param status - Whether the attempt succeeded or failed
   * @param error - Error message if failed
   * @param client - Optional PoolClient for transaction participation
   */
  record(
    notificationId: string,
    attempt: number,
    status: 'success' | 'failure',
    error?: string,
    client?: PoolClient
  ): Promise<void>;

  /**
   * Count delivery attempts for a notification.
   *
   * @param notificationId - ID of the notification
   * @param client - Optional PoolClient for transaction participation
   * @returns Number of recorded attempts
   */
  countByNotification(notificationId: string, client?: PoolClient): Promise<number>;

  /**
   * List delivery attempts for a notification.
   *
   * @param notificationId - ID of the notification
   * @param limit - Maximum results to return
   * @returns Array of attempt records
   */
  listByNotification(notificationId: string, limit?: number): Promise<Array<{
    id: string;
    attemptNumber: number;
    status: string;
    error: string | null;
    createdAt: Date;
  }>>;
}
