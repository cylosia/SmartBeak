
import { PoolClient } from 'pg';

import { NotificationPreference } from '../../domain/entities/NotificationPreference';

/**
* Repository interface for NotificationPreference persistence.
*
* This interface manages user notification preferences across different
* channels (email, sms, push, etc.).
*
* @throws {RepositoryError} Implementations should throw domain-appropriate errors
*/
export interface NotificationPreferenceRepository {
  /**
  * Get all notification preferences for a user
  *
  * @param userId - The unique identifier of the user
  * @returns Promise resolving to array of notification preferences
  * @throws {Error} If database query fails
  */
  getForUser(userId: string): Promise<NotificationPreference[]>;

  /**
  * Upsert (insert or update) a notification preference

  *
  * @param pref - The notification preference to save
  * @returns Promise resolving when save is complete
  * @throws {Error} If persistence operation fails
  */
  upsert(pref: NotificationPreference): Promise<void>;

  /**
  * Delete a notification preference
  * MEDIUM FIX M11: Added delete method
  *
  * @param id - The unique identifier of the preference to delete
  * @returns Promise resolving when deletion is complete
  * @throws {Error} If deletion fails
  */
  delete(id: string): Promise<void>;

  /**
  * Get a single preference by user and channel
  * MEDIUM FIX M12: Added getByUserAndChannel method
  *
  * @param userId - The unique identifier of the user
  * @param channel - The notification channel
  * @returns Promise resolving to the preference, or null if not found
  * @throws {Error} If database query fails
  */
  getByUserAndChannel(userId: string, channel: string): Promise<NotificationPreference | null>;

  /**
  * Batch save multiple notification preferences
  *
  * @param prefs - Array of notification preferences to save
  * @returns Promise resolving when all saves are complete
  * @throws {Error} If persistence operation fails
  */
  batchSave(prefs: NotificationPreference[]): Promise<void>;
}

/**
* Custom error class for repository operations
*/
export class NotificationPreferenceError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    override readonly cause?: unknown
  ) {
    super(message);
    this["name"] = 'NotificationPreferenceError';
  }
}
