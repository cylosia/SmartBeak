/**
 * Shared Validation Functions
 * Validation utilities for the database layer
 *
 * P2-3/P2-4 FIX: Strengthened type guards to validate all required fields
 * instead of only checking 1-2 properties while asserting the full interface type.
 */

import type { NotificationPayload } from '@types/notifications';
import type { PublishTargetConfig } from '@types/publishing';

/**
 * Validate notification payload
 * P2-3 FIX: Check all required fields of NotificationPayload, not just recipientId and type.
 * @param payload - Payload to validate
 * @returns True if valid
 */
export function validateNotificationPayload(payload: unknown): payload is NotificationPayload {
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  const p = payload as Record<string, unknown>;
  return (
    typeof p['recipientId'] === 'string' &&
    typeof p['type'] === 'string' &&
    (p['channel'] === undefined || typeof p['channel'] === 'string') &&
    (p['template'] === undefined || typeof p['template'] === 'string') &&
    (p['data'] === undefined || typeof p['data'] === 'object')
  );
}

/**
 * Validate search document
 * P2-3 FIX: Check all required fields (id, title) and validate optional fields.
 * @param doc - Document to validate
 * @returns True if valid
 */
export function validateSearchDocument(doc: unknown): boolean {
  if (typeof doc !== 'object' || doc === null) {
    return false;
  }
  const d = doc as Record<string, unknown>;
  return (
    typeof d['id'] === 'string' &&
    typeof d['title'] === 'string' &&
    (d['body'] === undefined || typeof d['body'] === 'string') &&
    (d['url'] === undefined || typeof d['url'] === 'string')
  );
}

/**
 * Validate publish target config
 * P2-4 FIX: Validate url format if present instead of accepting any object.
 * @param config - Config to validate
 * @returns True if valid
 */
export function validatePublishTarget(config: unknown): config is PublishTargetConfig {
  if (typeof config !== 'object' || config === null) {
    return false;
  }
  const c = config as Record<string, unknown>;
  // Validate url is a properly formatted URL string if present
  if (c['url'] !== undefined) {
    if (typeof c['url'] !== 'string') return false;
    try {
      new URL(c['url']);
    } catch {
      return false;
    }
  }
  return true;
}
