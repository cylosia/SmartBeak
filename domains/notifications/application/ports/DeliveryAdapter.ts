/**
* Payload data for notification delivery.
*
* Using Record type instead of 'any' for type safety while maintaining flexibility
* for different notification types and channels.
*/
export type NotificationPayload = Record<string, unknown>;

/**
* Input parameters for sending a notification
*/
export interface SendNotificationInput {
  /** The delivery channel (e.g., 'email', 'sms', 'push', 'webhook') */
  channel: string;
  /** Recipient identifier (format depends on channel: email address, phone number, device token, etc.) */
  to: string;
  /** Template identifier for the notification content */
  template: string;
  /** Dynamic data to populate the template */
  payload: NotificationPayload;
}

/**
* Result of a notification delivery attempt.
* Discriminated union prevents impossible states like
* { ok: true, error: "..." } or { ok: false, deliveryId: "..." }.
*/
export type DeliveryResult =
  | { ok: true; deliveryId: string; attemptedAt: Date }
  | { ok: false; error: string; errorCode?: string; attemptedAt: Date };

/**
* Adapter interface for notification delivery mechanisms.
*
* This interface abstracts the delivery of notifications across various channels
* (email, SMS, push notifications, webhooks, etc.). Implementations handle the
* specifics of each channel's protocol and provider integration.
*
* @example
* ```typescript
* // Email adapter implementation
* class EmailAdapter implements DeliveryAdapter {
*   async send(input: SendNotificationInput): Promise<DeliveryResult> {
*     // Send via SMTP or email service provider
*   }
* }
*
* // Usage
* const result = await adapter.send({
*   channel: 'email',
*   to: 'user@example.com',
*   template: 'welcome-email',
*   payload: { name: 'John', activationLink: 'https://...' }
* });
* ```
*/
export interface DeliveryAdapter {
  /**
  * Send a notification through the adapter's channel
  *
  * @param input - The notification details including channel, recipient, template, and payload
  * @returns Promise resolving to the delivery result
  * @throws Should not throw - errors should be returned in the DeliveryResult
  */
  send(input: SendNotificationInput): Promise<DeliveryResult>;
}

/**
* Configuration options for delivery adapters
*/
export interface DeliveryAdapterConfig {
  /** Maximum number of retry attempts for failed deliveries */
  maxRetries: number;
  /** Delay between retry attempts in milliseconds */
  retryDelayMs: number;
  /** Timeout for delivery operations in milliseconds */
  timeoutMs: number;
}

/**
* Error codes for delivery failures
*/
export type DeliveryErrorCode =
  | 'INVALID_RECIPIENT'
  | 'INVALID_TEMPLATE'
  | 'PROVIDER_ERROR'
  | 'RATE_LIMITED'
  | 'TIMEOUT'
  | 'CONFIGURATION_ERROR'
  | 'UNKNOWN_ERROR';

/**
* Custom error for delivery adapter operations
*/
export class DeliveryAdapterError extends Error {
  constructor(
  message: string,
  public readonly code: DeliveryErrorCode,
  public readonly recipient?: string,
  override readonly cause?: unknown
  ) {
  super(message);
  this["name"] = 'DeliveryAdapterError';
  }
}
