import fetch from 'node-fetch';
import crypto from 'crypto';
import {
  DeliveryAdapter,
  SendNotificationInput,
  DeliveryResult,
  DeliveryAdapterError
} from '../../packages/types/notifications.js';
import { getOptionalEnv, getEnvWithDefault } from '../../packages/config';

import { ErrorCodes, ExternalAPIError } from '../../packages/kernel/validation';
import { getLogger } from '../../packages/kernel/logger';

/**
* Webhook Notification Adapter
*
* Sends notifications via HTTP webhooks with security validation
*
* MEDIUM FIX C1: Replace direct process.env access with @config
* MEDIUM FIX E17: Add proper error handling in empty catch blocks
* MEDIUM FIX M6: Extract magic numbers to constants
* MEDIUM FIX M16: Add JSDoc comments
* MEDIUM FIX R1: Fix AbortController cleanup
*/

const logger = getLogger('WebhookAdapter');

/**
* Webhook timeout in milliseconds
* MEDIUM FIX M6: Extract magic numbers to constants
*/
const WEBHOOK_TIMEOUT_MS = 5000;

/**
* Maximum webhook payload size in bytes (1MB)
* MEDIUM FIX I5: Add length validation
*/
const MAX_WEBHOOK_PAYLOAD_SIZE = 1024 * 1024;

/**
* Get webhook allowlist from configuration
* MEDIUM FIX C1: Replace direct process.env access with @config
*
* @returns Array of allowed webhook URLs
* @throws Error if no valid URLs configured
*/
function getWebhookAllowlist(): string[] {
  const envAllowlist = getOptionalEnv('ALERT_WEBHOOK_URL') || getEnvWithDefault('SLACK_WEBHOOK_URL', '');

  if (!envAllowlist) {
    // P2-4 FIX: Error message now references the actual env vars being read
    throw new Error('ALERT_WEBHOOK_URL or SLACK_WEBHOOK_URL must be configured');
  }

  // Parse comma-separated list and validate each URL
  const urls = envAllowlist.split(',').map(url => url.trim()).filter(Boolean);
  const validUrls: string[] = [];

  for (const url of urls) {
    try {
      const parsed = new URL(url);
      // Only allow HTTPS URLs
      if (parsed.protocol !== 'https:') {
        logger.warn(`Skipping non-HTTPS URL: ${url}`);
        continue;
      }
      validUrls.push(url);
    } catch (error) {
      logger.warn(`Invalid URL in allowlist: ${url}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (validUrls.length === 0) {
    throw new Error('No valid HTTPS URLs in WEBHOOK_ALLOWLIST');
  }

  return validUrls;
}

/**
* Webhook delivery adapter implementation
*
* MEDIUM FIX M16: Add JSDoc comments
*/
export class WebhookAdapter implements DeliveryAdapter {
  private allowlist: string[];

  /**
  * Create a new WebhookAdapter
  * MEDIUM FIX M16: Add JSDoc comments
  */
  constructor() {
    this.allowlist = getWebhookAllowlist();
  }

  /**
  * Send notification via webhook
  *
  * MEDIUM FIX C1: Replace direct process.env access with @config
  * MEDIUM FIX E17: Add proper error handling in empty catch blocks
  * MEDIUM FIX M6: Extract magic numbers to constants
  * MEDIUM FIX M16: Add JSDoc comments
  * MEDIUM FIX R1: Fix AbortController cleanup
  * MEDIUM FIX I5: Add length validation
  *
  * @param input - Send notification input
  * @param input.channel - The delivery channel (always 'webhook')
  * @param input.to - Target webhook URL
  * @param input.template - Template name (optional for webhooks)
  * @param input.payload - Payload data
  * @returns Delivery result with success status
  */
  async send({ channel: _channel, to, template: _template, payload }: SendNotificationInput): Promise<DeliveryResult> {
    const attemptedAt = new Date();
    
    try {
      // Validate target URL
      let targetUrl: URL;
      try {
        targetUrl = new URL(to);
      } catch (error) {
        throw new ExternalAPIError(
          `Invalid webhook target URL: ${to}`,
          ErrorCodes.INVALID_URL,
          { targetUrl: to },
          error instanceof Error ? error : undefined
        );
      }

      // Check if target URL is in allowlist
      const isAllowed = this.allowlist.some(allowed => {
        try {
          const allowedUrl = new URL(allowed);
          // Match protocol, hostname, and port (if specified)
          return (
            targetUrl.protocol === allowedUrl.protocol &&
            targetUrl.hostname === allowedUrl.hostname &&
            targetUrl.port === allowedUrl.port &&
            // Ensure target path starts with allowed path
            targetUrl.pathname.startsWith(allowedUrl.pathname)
          );
        } catch (error) {
          logger.warn('Error parsing allowlist URL', {
            allowed,
            error: error instanceof Error ? error.message : String(error),
          });
          return false;
        }
      });

      if (!isAllowed) {
        throw new ExternalAPIError(
          `Webhook target not allowed: ${targetUrl.origin}`,
          ErrorCodes.FORBIDDEN,
          { targetUrl: to, allowedHosts: this.allowlist }
        );
      }

      // P2-5 FIX: Use Buffer.byteLength for accurate byte count (not character count)
      const payloadJson = JSON.stringify(payload);
      const payloadSize = Buffer.byteLength(payloadJson, 'utf8');
      if (payloadSize > MAX_WEBHOOK_PAYLOAD_SIZE) {
        throw new ExternalAPIError(
          `Webhook payload exceeds maximum size of ${MAX_WEBHOOK_PAYLOAD_SIZE} bytes`,
          ErrorCodes.INVALID_LENGTH,
          { payloadSize, maxSize: MAX_WEBHOOK_PAYLOAD_SIZE }
        );
      }

      const controller = new AbortController();
      let timeout: ReturnType<typeof setTimeout> | null = null;

      try {
        timeout = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS);

        // P2-6 FIX: Use normalized URL from parsed targetUrl instead of raw input
        const res = await fetch(targetUrl.toString(), {
          method: 'POST',
          body: payloadJson,
          headers: { 'Content-Type': 'application/json' },
          signal: controller.signal
        });

        if (!res.ok) {
          throw new ExternalAPIError(
            `Webhook failed: ${res.status} ${res.statusText}`,
            ErrorCodes.EXTERNAL_API_ERROR,
            { status: res.status, statusText: res.statusText, targetUrl: to }
          );
        }
      } finally {
        if (timeout) {
          clearTimeout(timeout);
        }
      }

      return {
        ok: true,
        attemptedAt,
        // P2-7 FIX: Use crypto.randomBytes instead of Math.random(); .substring() instead of deprecated .substr()
        deliveryId: `webhook_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`
      };
    } catch (error) {
      return {
        ok: false,
        attemptedAt,
        error: error instanceof Error ? error.message : String(error),
        errorCode: error instanceof DeliveryAdapterError ? (error as DeliveryAdapterError).code : 'UNKNOWN_ERROR'
      };
    }
  }
}
