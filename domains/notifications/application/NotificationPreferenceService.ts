import { randomUUID } from 'crypto';

import { NotificationPreference } from '../domain/entities/NotificationPreference';
import { NotificationPreferenceRepository } from './ports/NotificationPreferenceRepository';

﻿
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
    // Check for existing preference
    const existing = await this.repo.getForUser(userId);
    const existingPref = existing.find(p => p.channel === channel);

    let preference: NotificationPreference;

    if (existingPref) {
    // Update existing preference (immutable)
    if (existingPref.isEnabled() !== enabled) {
    preference = enabled ? existingPref.enable() : existingPref.disable();
    } else {
    preference = existingPref;
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

    await this.repo.upsert(preference);

    return { success: true, preference };
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
  * @param userId - User ID
  * @returns Promise resolving to the result of the operation
  */
  async disableAll(userId: string): Promise<PreferenceResult> {
  const validationError = this.validateUserId(userId);
  if (validationError) {
    return { success: false, error: validationError };
  }

  try {
    const preferences = await this.repo.getForUser(userId);

    // P1-FIX: Batch update all preferences at once instead of N+1 individual saves
    const updated = preferences.map((pref) => pref.disable());

    // Use batchSave if available, otherwise fall back to sequential upserts
    if ('batchSave' in this.repo && typeof this.repo.batchSave === 'function') {
    await this.repo.batchSave(updated);
    } else {
    // Fallback: Use Promise.all for parallel execution (better than sequential)
    await Promise.all(updated.map((pref) => this.repo.upsert(pref)));
    }

    return { success: true, preferences: updated };
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
