import { UsageService } from './usage';

﻿import { EventBus } from '@kernel/event-bus';


/**
* Usage event handlers
*/

/**
* Content published event structure
*/
export interface ContentPublishedEvent {
  meta: {
  domainId: string;
  };
}

/**
* Register event handlers for usage tracking
* @param eventBus - Event bus instance
* @param usage - Usage service instance
*/
export function registerUsageEventHandlers(eventBus: EventBus, usage: UsageService): void {
  eventBus.subscribe('content.published', 'usage', async (event: ContentPublishedEvent) => {
  try {
    if (!event?.["meta"]?.["domainId"]) {
    const timestamp = new Date().toISOString();
    process.stderr.write(`[${timestamp}] [ERROR] [usage-events] Invalid event: missing domainId\n`);
    return;
    }
    await usage.increment(event["meta"]["domainId"], 'publish_count', 1);
  } catch (error) {
    const timestamp = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[${timestamp}] [ERROR] [usage-events] Failed to increment usage: ${errorMessage}\n`);
  }
  });
}
