import { Pool } from 'pg';

import { EventBus } from '@kernel/event-bus';
import { getLogger } from '@kernel/logger';

import { EmailAdapter } from '../../plugins/notification-adapters/email-adapter';
import { NotificationService } from '../../domains/notifications/application/NotificationService';
import { NotificationWorker } from '../../domains/notifications/application/NotificationWorker';
import { PostgresNotificationAttemptRepository } from '../../domains/notifications/infra/persistence/PostgresNotificationAttemptRepository';
import { PostgresNotificationDLQRepository } from '../../domains/notifications/infra/persistence/PostgresNotificationDLQRepository';
import { PostgresNotificationPreferenceRepository } from '../../domains/notifications/infra/persistence/PostgresNotificationPreferenceRepository';
import { PostgresNotificationRepository } from '../../domains/notifications/infra/persistence/PostgresNotificationRepository';
import { WebhookAdapter } from '../../plugins/notification-adapters/webhook-adapter';

const logger = getLogger('notifications-hook');

﻿


/**

* Get admin notification email from environment
*/
function getAdminEmail(): string {
  const email = process.env['ADMIN_NOTIFICATION_EMAIL'];
  if (!email) {
  const timestamp = new Date().toISOString();
  process.stderr.write(`[${timestamp}] [WARN] [notifications-hook] ADMIN_NOTIFICATION_EMAIL not set, using fallback\n`);
  return 'admin@example.com';
  }
  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
  const timestamp = new Date().toISOString();
  process.stderr.write(`[${timestamp}] [WARN] [notifications-hook] Invalid ADMIN_NOTIFICATION_EMAIL format, using fallback\n`);
  return 'admin@example.com';
  }
  return email;
}

export interface PublishingFailedEvent {
  meta: {
  domainId: string;
  orgId?: string;
  };
  payload: {
  contentId?: string;
  error?: string;
  target?: string;
  };
}

// Singleton adapter instances to prevent duplicate connections
let emailAdapter: EmailAdapter | null = null;
let webhookAdapter: WebhookAdapter | null = null;

function getEmailAdapter(): EmailAdapter {
  if (!emailAdapter) {
  emailAdapter = new EmailAdapter();
  }
  return emailAdapter;
}

function getWebhookAdapter(): WebhookAdapter {
  if (!webhookAdapter) {
  webhookAdapter = new WebhookAdapter();
  }
  return webhookAdapter;
}

/**
* Validate event structure
*/
function validatePublishingFailedEvent(event: unknown): event is PublishingFailedEvent {
  if (!event || typeof event !== 'object') return false;
  const e = event as Record<string, unknown>;

  if (!e["meta"] || typeof e["meta"] !== 'object') return false;
  const meta = e["meta"] as Record<string, unknown>;
  if (typeof meta["domainId"] !== 'string') return false;
  if (meta["orgId"] !== undefined && typeof meta["orgId"] !== 'string') return false;

  if (!e["payload"] || typeof e["payload"] !== 'object') return false;
  const payload = e["payload"] as Record<string, unknown>;
  if (payload["contentId"] !== undefined && typeof payload["contentId"] !== 'string') return false;
  if (payload["error"] !== undefined && typeof payload["error"] !== 'string') return false;
  if (payload["target"] !== undefined && typeof payload["target"] !== 'string') return false;

  return true;
}

export function registerNotificationsDomain(eventBus: EventBus, pool: Pool): void {
  const repo = new PostgresNotificationRepository(pool);
  const attempts = new PostgresNotificationAttemptRepository(pool);
  const prefs = new PostgresNotificationPreferenceRepository(pool);
  const dlq = new PostgresNotificationDLQRepository(pool);
  const service = new NotificationService(repo);
  const worker = new NotificationWorker(
    repo,
    attempts,
    {
      email: getEmailAdapter(),
      webhook: getWebhookAdapter()
    },
    prefs,
    dlq,
    eventBus,
    pool
  );

  eventBus.subscribe('publishing.failed', 'notifications-domain', async (event: unknown) => {
  try {
    // Validate event structure
    if (!validatePublishingFailedEvent(event)) {
    const timestamp = new Date().toISOString();
    process.stderr.write(`[${timestamp}] [ERROR] [notifications-hook] Invalid event structure\n`);
    return;
    }

    const adminEmail = getAdminEmail();

    const result = await service.create(
    event["meta"]["domainId"],
    'admin-user',
    'email',
    'publishing_failed',
    {
    to: adminEmail,
    domainId: event["meta"]["domainId"],
    contentId: event["payload"]?.["contentId"],
    error: event["payload"]?.["error"],
    target: event["payload"]?.["target"],
    timestamp: new Date().toISOString(),
    ...event["payload"]
    }
    );

    if (result.success && result.notification) {
      await worker.process(result.notification["id"]);
    } else {
      logger["error"]('Failed to create notification: ' + (result["error"] || 'Unknown error'));
    }
  } catch (error) {
    const timestamp = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[${timestamp}] [ERROR] [notifications-hook] Failed to process publishing.failed event: ${errorMessage}\n`);
    // Don't throw - prevent event bus from crashing
  }
  });
}
