/**
* Notifications Types Package
* Shared types for notification delivery adapters
*
* This package provides centralized notification types to prevent
* cross-boundary imports between plugins and domains.
*/

/**
* Payload data for notification delivery.
*/
export type NotificationPayload = Record<string, unknown>;

/**
* Notification attachment (for email notifications)
*/
export interface NotificationAttachment {
  /** File name */
  filename: string;
  /** File content (Buffer or base64 string) */
  content: Buffer | string;
  /** MIME content type */
  contentType?: string;
}

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
* Result of a notification delivery attempt
*/
export interface DeliveryResult {
  /** Whether the delivery was successful */
  success: boolean;
  /** Unique identifier for the delivery attempt (for tracking) */
  deliveryId?: string;
  /** Timestamp when the delivery was attempted */
  attemptedAt: Date;
  /** Error message if delivery failed */
  error?: string;
  /** Error code for programmatic handling */
  errorCode?: string;
}

/**
* Adapter interface for notification delivery mechanisms.
*/
export interface DeliveryAdapter {
  /**
  * Send a notification through the adapter's channel
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
  this.name = 'DeliveryAdapterError';
  }
}

/**
* Notification attempt entity (simplified for shared use)
*/
export interface NotificationAttempt {
  id: string;
  notificationId: string;
  channel: string;
  status: 'pending' | 'sent' | 'failed' | 'delivered';
  sentAt?: Date;
  deliveredAt?: Date;
  failedAt?: Date;
  errorMessage?: string;
  errorCode?: string;
  providerResponse?: Record<string, unknown>;
  retryCount: number;
  metadata?: Record<string, unknown>;
}
