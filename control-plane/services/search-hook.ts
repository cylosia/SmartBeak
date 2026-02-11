
// Event interfaces for type safety


import { Pool } from 'pg';

import { EventBus } from '@kernel/event-bus';
import { getLogger } from '@kernel/logger';

const logger = getLogger('search-hook');

import { PostgresIndexingJobRepository } from '../../domains/search/infra/persistence/PostgresIndexingJobRepository';
import { PostgresSearchIndexRepository } from '../../domains/search/infra/persistence/PostgresSearchIndexRepository';
import { SearchIndexingService } from '../../domains/search/application/SearchIndexingService';

export interface ContentPublishedEvent {
  meta: { domainId: string };
  payload: { contentId: string };
}

export interface ContentUnpublishedEvent {
  meta: { domainId: string };
  payload: { contentId: string };
}

/**
* Validate content published event structure
*/
function validateContentPublishedEvent(event: unknown): event is ContentPublishedEvent {
  if (!event || typeof event !== 'object') return false;
  const e = event as Record<string, unknown>;

  if (!e["meta"] || typeof e["meta"] !== 'object') return false;
  const meta = e["meta"] as Record<string, unknown>;
  if (typeof meta["domainId"] !== 'string') return false;

  if (!e["payload"] || typeof e["payload"] !== 'object') return false;
  const payload = e["payload"] as Record<string, unknown>;
  if (typeof payload["contentId"] !== 'string') return false;

  return true;
}

/**
* Validate content unpublished event structure
*/
function validateContentUnpublishedEvent(event: unknown): event is ContentUnpublishedEvent {
  // Same structure as published event
  return validateContentPublishedEvent(event);
}

export function registerSearchDomain(eventBus: EventBus, pool: Pool) {
  const jobs = new PostgresIndexingJobRepository(pool);
  const indexes = new PostgresSearchIndexRepository(pool);
  const service = new SearchIndexingService(jobs, indexes, pool);

  eventBus.subscribe('content.published', 'search-domain', async (event: unknown) => {
  try {
    // Validate event structure
    if (!validateContentPublishedEvent(event)) {
    logger.error('Invalid event structure for content.published', new Error('Invalid event'), { event });
    return;
    }

    await service.enqueueIndex(event.meta.domainId, event.payload.contentId);
  } catch (error) {
    logger.error('Search indexing failed for content.published', error instanceof Error ? error : new Error(String(error)));
    // Not re-throwing to prevent event bus crash
  }
  });

  eventBus.subscribe('content.unpublished', 'search-domain', async (event: unknown) => {
  try {
    // Validate event structure
    if (!validateContentUnpublishedEvent(event)) {
    logger.error('Invalid event structure for content.unpublished', undefined, { event });
    return;
    }

    await service.enqueueDelete(event.meta.domainId, event.payload.contentId);
  } catch (error) {
    logger.error('Search removal failed for content.unpublished', error instanceof Error ? error : new Error(String(error)));
    // Not re-throwing to prevent event bus crash
  }
  });
}
