import { PoolClient } from 'pg';

/**
 * Port interface for the Notification Dead Letter Queue persistence.
 *
 * Defines the contract for recording and querying failed notifications
 * that have exhausted all delivery attempts.
 * Application layer code must depend on this interface, not on concrete
 * infrastructure implementations.
 */
export interface NotificationDLQRepository {
  /**
   * Record a notification in the dead letter queue.
   *
   * @param notificationId - ID of the failed notification
   * @param channel - Delivery channel that failed
   * @param reason - Reason for failure (will be truncated if too long)
   * @param client - Optional PoolClient for transaction participation
   */
  record(
    notificationId: string,
    channel: string,
    reason: string,
    client?: PoolClient
  ): Promise<void>;

  /**
   * List DLQ entries scoped to an organization.
   *
   * @param orgId - Organization ID to scope the query
   * @param limit - Maximum results to return
   * @returns Array of DLQ entries
   */
  list(orgId: string, limit?: number): Promise<Array<{
    id: string;
    notificationId: string;
    channel: string;
    reason: string;
    createdAt: Date;
  }>>;

  /**
   * Delete a DLQ entry, scoped to the caller's organization.
   *
   * @param id - DLQ entry ID
   * @param orgId - Organization ID for ownership verification
   */
  delete(id: string, orgId: string): Promise<void>;

  /**
   * Get a single DLQ entry by ID, scoped to the caller's organization.
   *
   * @param id - DLQ entry ID
   * @param orgId - Organization ID for ownership verification
   * @returns DLQ entry or null if not found / access denied
   */
  getById(id: string, orgId: string): Promise<{
    id: string;
    notificationId: string;
    channel: string;
    reason: string;
    createdAt: Date;
  } | null>;
}
