/**
* NotificationPreference - Immutable domain entity for user notification preferences
*/
export class NotificationPreference {
  private constructor(
  public readonly id: string,
  public readonly userId: string,
  public readonly channel: string,
  private readonly _enabled: boolean,
  public readonly frequency: 'immediate' | 'daily' | 'weekly'
  ) {}

  // Valid frequency values for runtime validation
  private static readonly VALID_FREQUENCIES: Array<'immediate' | 'daily' | 'weekly'> = ['immediate', 'daily', 'weekly'];

  /**
  * Validate frequency value
  */
  private static validateFrequency(frequency: string): void {
  if (!NotificationPreference.VALID_FREQUENCIES.includes(frequency as 'immediate' | 'daily' | 'weekly')) {
    throw new Error(`Invalid frequency: ${frequency}. Must be one of: ${NotificationPreference.VALID_FREQUENCIES.join(', ')}`);
  }
  }

  /**
  * Create a new notification preference
  * @param id - Unique identifier
  * @param userId - User ID
  * @param channel - Notification channel
  * @param enabled - Whether notifications are enabled
  * @param frequency - Delivery frequency
  * @returns New NotificationPreference instance
  */
  static create(
  id: string,
  userId: string,
  channel: string,
  enabled: boolean,
  frequency: 'immediate' | 'daily' | 'weekly'
  ): NotificationPreference {
  NotificationPreference.validateFrequency(frequency);
  return new NotificationPreference(id, userId, channel, enabled, frequency);
  }

  /**
  * Reconstitute from persistence
  */
  static reconstitute(
  id: string,
  userId: string,
  channel: string,
  enabled: boolean,
  frequency: 'immediate' | 'daily' | 'weekly'
  ): NotificationPreference {
  NotificationPreference.validateFrequency(frequency);
  return new NotificationPreference(id, userId, channel, enabled, frequency);
  }

  /**
  * Get enabled status
  */
  isEnabled(): boolean {
  return this._enabled;
  }

  /**
  * Enable notifications - returns new immutable instance
  * @returns New NotificationPreference with enabled=true
  */
  enable(): NotificationPreference {
  if (this._enabled) {
    return this;
  }
  return new NotificationPreference(
    this["id"],
    this.userId,
    this.channel,
    true,
    this.frequency
  );
  }

  /**
  * Disable notifications - returns new immutable instance
  * @returns New NotificationPreference with enabled=false
  */
  disable(): NotificationPreference {
  if (!this._enabled) {
    return this;
  }
  return new NotificationPreference(
    this["id"],
    this.userId,
    this.channel,
    false,
    this.frequency
  );
  }

  /**
  * Change frequency - returns new immutable instance
  * @param frequency - New frequency setting
  * @returns New NotificationPreference with updated frequency
  */
  setFrequency(frequency: 'immediate' | 'daily' | 'weekly'): NotificationPreference {
  NotificationPreference.validateFrequency(frequency);
  return new NotificationPreference(
    this["id"],
    this.userId,
    this.channel,
    this._enabled,
    frequency,
  );
  }
}
