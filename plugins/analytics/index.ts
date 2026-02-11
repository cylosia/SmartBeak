import { CONTENT_PUBLISHED_V1, type ContentPublishedV1Payload } from '../../packages/types/events/content-published.v1';
import type { AnalyticsCapability } from '../../packages/types/plugin-capabilities';
import type { Pool } from 'pg';

import { EventBus } from '@kernel/event-bus';

import { AnalyticsReadModel } from '../../control-plane/services/analytics-read-model';

export function registerAnalyticsPlugin(
  eventBus: EventBus,
  { analytics, pool }: { analytics: AnalyticsCapability; pool: Pool }
) {
  const readModel = new AnalyticsReadModel(pool);

  eventBus.subscribe<ContentPublishedV1Payload>(
    CONTENT_PUBLISHED_V1["name"],
    'analytics',
    async (event) => {
      if (event.version !== CONTENT_PUBLISHED_V1.version) return;
      await analytics.recordMetric('content.published', 1);
      await readModel.incrementPublish(event.payload.contentId);
    }
  );
}
