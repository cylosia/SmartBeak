import { EventBus } from '@kernel/event-bus';
import { getLogger } from '@kernel/logger';

const logger = getLogger('seo-plugin');

interface SeoUpdatedPayload {
  seoId: string;
}

export function registerSeoPlugin(eventBus: EventBus) {
  eventBus.subscribe<SeoUpdatedPayload>('seo.updated', 'seo-plugin', async (event) => {
    logger.info('SEO updated', { seoId: event.payload.seoId });
  });
}
