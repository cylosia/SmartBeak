import { CONTENT_PUBLISHED_V1, type ContentPublishedV1Payload } from '../../packages/types/events/content-published.v1';
import type { PublishingCapability } from '../../packages/types/plugin-capabilities';

import { EventBus } from '@kernel/event-bus';

export function registerPublishingPlugin(
  eventBus: EventBus,
  { publishing }: { publishing: PublishingCapability }
) {
  eventBus.subscribe<ContentPublishedV1Payload>(
    CONTENT_PUBLISHED_V1["name"],
    'publishing',
    async (event) => {
      if (event.version !== CONTENT_PUBLISHED_V1.version) return;
      await publishing.enqueuePublishJob(event.payload.contentId);
    }
  );
}
