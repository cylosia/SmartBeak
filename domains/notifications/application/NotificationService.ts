import { randomUUID } from 'crypto';

import { withSpan, addSpanAttributes } from '@packages/monitoring';
import type { NotificationChannel } from '@packages/types/notifications';

import { Notification, NotificationPayload } from '../domain/entities/Notification';
import { NotificationRepository } from './ports/NotificationRepository';


// ============================================================================
// Type Definitions
// ============================================================================



/**
* Result type for create notification operation (discriminated union)
*/
export type CreateNotificationResult =
  | { success: true; notification: Notification }
  | { success: false; error: string };

// ============================================================================
// Notification Service
// ============================================================================

/**
* Service for managing notifications.
*
* This service provides high-level operations for creating and managing
* notifications with proper validation and error handling.
*/
export class NotificationService {
  /** Maximum payload size in bytes (100KB) */
  private static readonly MAX_PAYLOAD_SIZE = 100 * 1024;
  /** Allowed channels whitelist */
  private static readonly ALLOWED_CHANNELS: readonly NotificationChannel[] = ['email', 'sms', 'push', 'webhook'];

  /**
  * Create a new NotificationService
  * @param notifications - Notification repository
  */
  constructor(private readonly notifications: NotificationRepository) {}

  /**
  * Create a new notification
  *
  * @param orgId - Organization ID
  * @param userId - User ID
  * @param channel - Delivery channel (email, sms, push, webhook)
  * @param template - Template identifier
  * @param payload - Notification payload data
  * @returns Promise resolving to the result of the operation
  *
  * @example
  * ```typescript
  * const result = await service.create(
  *   'org-123',
  *   'user-456',
  *   'email',
  *   'welcome-email',
  *   { to: 'user@example.com', subject: 'Welcome!' }
  * );
  * if (result.success) {
  *   // Notification created successfully
  * }
  * ```
  */
  async create(
  orgId: string,
  userId: string,
  channel: NotificationChannel,
  template: string,
  payload: NotificationPayload
  ): Promise<CreateNotificationResult> {
  return withSpan({
    spanName: 'NotificationService.create',
    attributes: {
    'notification.org_id': orgId,
    'notification.channel': channel,
    'notification.template': template,
    },
  }, async () => {
    // Validate inputs
    const validationError = this.validateInputs(orgId, userId, channel, template, payload);
    if (validationError) {
    addSpanAttributes({ 'notification.result': 'validation_failed' });
    return { success: false, error: validationError };
    }

    // Sanitize payload
    const sanitizedPayload = this.sanitizePayload(payload);

    try {
    const notification = Notification.create(
      randomUUID(),
      orgId,
      userId,
      channel,
      template,
      sanitizedPayload,
      'pending'
    );

    await this.notifications.save(notification);

    addSpanAttributes({ 'notification.result': 'success' });
    return { success: true, notification };
    } catch (error) {
    addSpanAttributes({ 'notification.result': 'error' });
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Failed to create notification'
    };
    }
  });
  }

  // ============================================================================
  // Validation & Sanitization
  // ============================================================================

  /**
  * Validates all input parameters
  * @param orgId - Organization ID
  * @param userId - User ID
  * @param channel - Delivery channel
  * @param template - Template identifier
  * @param payload - Notification payload
  * @returns Error message if invalid, undefined if valid
  */
  private validateInputs(
  orgId: string,
  userId: string,
  channel: NotificationChannel,
  template: string,
  payload: NotificationPayload
  ): string | undefined {
  // Validate orgId
  if (!orgId || typeof orgId !== 'string') {
    return 'Organization ID is required and must be a string';
  }
  if (orgId.length < 1 || orgId.length > 255) {
    return 'Organization ID must be between 1 and 255 characters';
  }

  // Validate userId
  if (!userId || typeof userId !== 'string') {
    return 'User ID is required and must be a string';
  }
  if (userId.length < 1 || userId.length > 255) {
    return 'User ID must be between 1 and 255 characters';
  }

  // Validate channel against whitelist (defense-in-depth)
  if (!NotificationService.ALLOWED_CHANNELS.includes(channel)) {
    return `Invalid channel '${channel}'. Allowed channels: ${NotificationService.ALLOWED_CHANNELS.join(', ')}`;
  }

  // Validate template
  if (!template || typeof template !== 'string') {
    return 'Template is required and must be a string';
  }
  if (template.length < 1 || template.length > 255) {
    return 'Template must be between 1 and 255 characters';
  }

  // Validate payload size
  const payloadSize = JSON.stringify(payload).length;
  if (payloadSize > NotificationService.MAX_PAYLOAD_SIZE) {
    return `Payload size (${payloadSize} bytes) exceeds maximum allowed (${NotificationService.MAX_PAYLOAD_SIZE} bytes)`;
  }

  return undefined;
  }

  /**
  * Sanitizes notification payload for security
  * @param payload - Payload to sanitize
  * @returns Sanitized payload
  */
  private sanitizePayload(payload: NotificationPayload): NotificationPayload {
  const sanitized: NotificationPayload = {};

  // Copy allowed fields with sanitization
  if (payload.to !== undefined) {
    sanitized.to = this.sanitizeString(String(payload.to));
  }
  if (payload.subject !== undefined) {
    sanitized.subject = this.sanitizeString(String(payload.subject));
  }
  if (payload["body"] !== undefined) {
    sanitized["body"] = this.sanitizeString(String(payload["body"]));
  }
  if (payload.data !== undefined && typeof payload.data === 'object') {
    sanitized.data = this.sanitizeObject(payload.data);
  }

  return sanitized;
  }

  /**
  * Sanitizes a string value
  * @param value - String to sanitize
  * @returns Sanitized string
  */
  private sanitizeString(value: string): string {
  // Remove null bytes and control characters
  return value
    .replace(/\0/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  }

  /**
  * Sanitizes an object recursively
  * @param obj - Object to sanitize
  * @returns Sanitized object
  */
  // P2-FIX: Added depth parameter to prevent stack overflow from deeply nested payloads
  private static readonly MAX_SANITIZE_DEPTH = 10;

  private sanitizeObject(obj: Record<string, unknown>, depth = 0): Record<string, unknown> {
  if (depth >= NotificationService.MAX_SANITIZE_DEPTH) {
    return {}; // Truncate overly nested objects
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(obj)) {
    // Sanitize key
    const sanitizedKey = this.sanitizeString(key).substring(0, 255);

    // Sanitize value based on type
    if (typeof value === 'string') {
    sanitized[sanitizedKey] = this.sanitizeString(value);
    } else if (typeof value === 'number' || typeof value === 'boolean') {
    sanitized[sanitizedKey] = value;
    } else if (value === null) {
    sanitized[sanitizedKey] = null;
    } else if (typeof value === 'object' && !Array.isArray(value)) {
    sanitized[sanitizedKey] = this.sanitizeObject(value as Record<string, unknown>, depth + 1);
    } else {
    // Arrays and other types - convert to string
    sanitized[sanitizedKey] = String(value);
    }
  }

  return sanitized;
  }
}
