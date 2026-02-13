import { randomUUID } from 'crypto';

import { withTransaction } from '@packages/database/transactions';

import { NotificationPreference } from '../domain/entities/NotificationPreference';
import { NotificationPreferenceRepository } from './ports/NotificationPreferenceRepository';


// ============================================================================
// Type Definitions
// ============================================================================



/**
* Result type for preference operations
*/
export interface PreferenceResult {
  /** Whether operation succeeded */
  success: boolean;
  /** List of preferences */
  preferences?: NotificationPreference[];
  /** Single preference */
  preference?: NotificationPreference;
  /** Error message (if failed) */
  error?: string;
}

// ============================================================================
// Notification Preference Service
// ============================================================================

/**
* Service for managing notification preferences.
*
* This service provides operations for getting and setting user notification
* preferences with proper validation and error handling.
*
* Read-modify-write operations (set, disableAll) are wrapped in transactions
* with row-level locking (FOR UPDATE) to prevent race conditions from
* concurrent updates.
*/
export class NotificationPreferenceService {
  /** Allowed channels whitelist */
  private static readonly ALLOWED_CHANNELS = ['email', 'sms', 'push', 'webhook'];
  /** Allowed frequencies */
  private static readonly ALLOWED_FREQUENCIES = ['immediate', 'daily', 'weekly'];

  /**
  * Create a new NotificationPreferenceService
  * @param repo - Notification preference repository
  */
  constructor(private readonly repo: NotificationPreferenceRepository) {}

  /**
  * List notification preferences for a user
  *
  * @param userId - User ID
  * @returns Promise resolving to the result of the operation
  *
  * @example
  * ```typescript
  * const result = await service.list('user-123');
  * if (result.success) {
  *   // Preferences retrieved successfully
  * }
  * ```
  */
  async list(userId: string): Promise<PreferenceResult> {
  // Validate input
  const validationError = this.validateUserId(userId);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const preferences = await this.repo.getForUser(userId);
    return { success: true, preferences };
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to get preferences'
    };
  }
  }

  /**
  * Set notification preference for a user
  *
  * Uses a transaction with FOR UPDATE row locking to prevent read-modify-write
  * race conditions when concurrent requests update preferences for the same user.
  *
  * @param userId - User ID
  * @param channel - Notification channel
  * @param enabled - Whether notifications are enabled
  * @param frequency - Delivery frequency
  * @returns Promise resolving to the result of the operation
  *
  * @example
  * ```typescript
  * const result = await service.set('user-123', 'email', true, 'daily');
  * if (result.success) {
  *   // Preference set successfully
  * }
  * ```
  */
  async set(
  userId: string,
  channel: string,
  enabled: boolean,
  frequency: 'immediate' | 'daily' | 'weekly'
  ): Promise<PreferenceResult> {
  // Validate inputs
  const validationError = this.validateInputs(userId, channel, frequency);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    // Wrap in transaction with FOR UPDATE to prevent concurrent read-modify-write races.
    // Without this, two concurrent set() calls for the same user could read stale data
    // and the last write would silently overwrite the first.
    return await withTransaction(async (client) => {
    // Lock the specific user+channel row (or nothing if it doesn't exist yet)
    const existingPref = await this.repo.getByUserAndChannel(
      userId, channel, client, { forUpdate: true }
    );

    let preference: NotificationPreference;

    if (existingPref) {
      // Update existing preference (immutable)
      preference = existingPref;
      if (existingPref.isEnabled() !== enabled) {
      preference = enabled ? preference.enable() : preference.disable();
      }
      if (existingPref.frequency !== frequency) {
      preference = preference.setFrequency(frequency);
      }
    } else {
      // Create new preference
      preference = NotificationPreference.create(
      randomUUID(),
      userId,
      channel,
      enabled,
      frequency,
      );
    }

    await this.repo.upsert(preference, client);

    return { success: true, preference };
    });
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to set preference'
    };
  }
  }

  /**
  * Disable all notifications for a user
  *
  * Uses a transaction with FOR UPDATE row locking to prevent race conditions
  * where a concurrent set() call could re-enable a channel between read and write.
  *
  * @param userId - User ID
  * @returns Promise resolving to the result of the operation
  */
  async disableAll(userId: string): Promise<PreferenceResult> {
  const validationError = this.validateUserId(userId);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    // Wrap in transaction with FOR UPDATE to prevent concurrent modifications
    // from re-enabling channels between our read and write.
    return await withTransaction(async (client) => {
    // Lock all preference rows for this user
    const preferences = await this.repo.getForUser(userId, client, { forUpdate: true });

    const updated = preferences.map((pref) => pref.disable());

    await this.repo.batchSave(updated, client);

    return { success: true, preferences: updated };
    });
  } catch (error) {
    return {
    success: false,
    error: error instanceof Error ? error.message : 'Failed to disable notifications'
    };
  }
  }

  // ============================================================================
  // Validation
  // ============================================================================

  /**
  * Validates user ID
  * @param userId - User ID to validate
  * @returns Error message if invalid, undefined if valid
  */
  private validateUserId(userId: string): string | undefined {
  if (!userId || typeof userId !== 'string') {
    return 'User ID is required and must be a string';
  }
  if (userId.length < 1 || userId.length > 255) {
    return 'User ID must be between 1 and 255 characters';
  }
  return undefined;
  }

  /**
  * Validates all inputs
  * @param userId - User ID
  * @param channel - Notification channel
  * @param frequency - Delivery frequency
  * @returns Error message if invalid, undefined if valid
  */
  private validateInputs(
  userId: string,
  channel: string,
  frequency: string
  ): string | undefined {
  const userError = this.validateUserId(userId);
  if (userError) {
    return userError;
  }

  if (!channel || typeof channel !== 'string') {
    return 'Channel is required and must be a string';
  }
  if (!NotificationPreferenceService.ALLOWED_CHANNELS.includes(channel.toLowerCase())) {
    return `Invalid channel '${channel}'. Allowed: ${NotificationPreferenceService.ALLOWED_CHANNELS.join(', ')}`;
  }

  if (!frequency || typeof frequency !== 'string') {
    return 'Frequency is required and must be a string';
  }
  if (!NotificationPreferenceService.ALLOWED_FREQUENCIES.includes(frequency.toLowerCase())) {
    return `Invalid frequency '${frequency}'. Allowed: ${NotificationPreferenceService.ALLOWED_FREQUENCIES.join(', ')}`;
  }

  return undefined;
  }
}
