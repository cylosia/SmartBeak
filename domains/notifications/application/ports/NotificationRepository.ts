
import { PoolClient } from 'pg';

import { Notification } from '../../domain/entities/Notification';

/**
* Repository interface for Notification persistence.
*

* This allows repositories to participate in parent transactions by passing a PoolClient.
*
* @throws {RepositoryError} Implementations should throw domain-appropriate errors
*/
export interface NotificationRepository {
  /**
  * Retrieve a notification by its unique ID
  *
  * @param id - The unique identifier of the notification
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to the notification
  * @throws {Error} If not found or database connection fails
  */
  getById(id: string, client?: PoolClient): Promise<Notification | null>;

  /**
  * Save or update a notification
  *
  * @param notification - The notification to persist
  * @param client - Optional database client for transaction context
  * @returns Promise resolving when save is complete
  * @throws {Error} If persistence operation fails
  */
  save(notification: Notification, client?: PoolClient): Promise<void>;

  /**
  * List all pending notifications with pagination
  *
  * @param limit - Maximum number of notifications to return
  * @param offset - Number of notifications to skip
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to array of pending notifications
  * @throws {Error} If query execution fails
  */
  listPending(limit?: number, offset?: number, client?: PoolClient): Promise<Notification[]>;

  /**
  * List notifications by user with pagination
  *
  * @param userId - The user identifier
  * @param limit - Maximum number of notifications to return
  * @param offset - Number of notifications to skip
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to array of notifications
  * @throws {Error} If query execution fails
  */
  listByUser(userId: string, limit?: number, offset?: number, client?: PoolClient): Promise<Notification[]>;

  /**
  * Batch save multiple notifications
  *
  * @param notifications - Array of notifications to save
  * @param client - Optional database client for transaction context
  * @returns Promise resolving when all saves are complete
  * @throws {Error} If persistence operation fails
  */
  batchSave(notifications: Notification[], client?: PoolClient): Promise<void>;

  /**
  * Delete old notifications for cleanup
  *
  * @param olderThan - Delete notifications older than this date
  * @param limit - Maximum number to delete
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to number of deleted notifications
  * @throws {Error} If deletion fails
  */
  deleteOld(olderThan: Date, limit?: number, client?: PoolClient): Promise<number>;
}

/**
* Custom error class for repository operations
*/
export class NotificationRepositoryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    override readonly cause?: unknown
  ) {
    super(message);
    this["name"] = 'NotificationRepositoryError';
  }
}
