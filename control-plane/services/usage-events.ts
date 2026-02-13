import { UsageService } from './usage';
import { EventBus } from '@kernel/event-bus';


/**
* Usage event handlers
*/

/**
* Content published event structure
* P0-FIX: Added orgId field — usage tracking requires org-level granularity,
* not domain-level. The org_usage table expects org_id, not domain_id.
*/
export interface ContentPublishedEvent {
  meta: {
  orgId: string;
  domainId: string;
  };
}

/**
* Register event handlers for usage tracking
* @param eventBus - Event bus instance
* @param usage - Usage service instance
*/
export function registerUsageEventHandlers(eventBus: EventBus, usage: UsageService): void {
  eventBus.subscribe('content.published', 'usage', async (event) => {
  const typedEvent = event as unknown as ContentPublishedEvent;
  try {
    // P0-FIX: Require orgId for correct usage tracking against org_usage table.
    // Previously used domainId which created orphaned rows in org_usage.
    if (!typedEvent?.meta?.orgId) {
    const timestamp = new Date().toISOString();
    process.stderr.write(`[${timestamp}] [ERROR] [usage-events] Invalid event: missing orgId\n`);
    return;
    }
    if (!typedEvent?.meta?.domainId) {
    const timestamp = new Date().toISOString();
    process.stderr.write(`[${timestamp}] [ERROR] [usage-events] Invalid event: missing domainId\n`);
    return;
    }
    await usage.increment(typedEvent.meta.orgId, 'publish_count', 1);
  } catch (error) {
    const timestamp = new Date().toISOString();
    const errorMessage = error instanceof Error ? error.message : String(error);
    process.stderr.write(`[${timestamp}] [ERROR] [usage-events] Failed to increment usage: ${errorMessage}\n`);
  }
  });
}
