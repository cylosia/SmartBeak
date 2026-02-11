/**
 * Shared Validation Functions
 * Validation utilities for the database layer
 */

import type { NotificationPayload } from '@packages/types/notifications';
import type { PublishTargetConfig } from '@packages/types/publishing';

/**
 * Validate notification payload
 * @param payload - Payload to validate
 * @returns True if valid
 */
export function validateNotificationPayload(payload: unknown): payload is NotificationPayload {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const p = payload as Record<string, unknown>;
  return typeof p['recipientId'] === 'string' && typeof p['type'] === 'string';
}

/**
 * Validate search document
 * @param doc - Document to validate
 * @returns True if valid
 */
export function validateSearchDocument(doc: unknown): boolean {
  if (typeof doc !== 'object' || doc === null) {
    return false;
  }
  const d = doc as Record<string, unknown>;
  return typeof d['id'] === 'string' && typeof d['title'] === 'string';
}

/**
 * Validate publish target config
 * @param config - Config to validate
 * @returns True if valid
 */
export function validatePublishTarget(config: unknown): config is PublishTargetConfig {
  if (typeof config !== 'object' || config === null) {
    return false;
  }
  const c = config as Record<string, unknown>;
  // Allow empty config or check for valid properties
  return c['url'] === undefined || typeof c['url'] === 'string';
}
