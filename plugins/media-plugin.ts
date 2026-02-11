import { EventBus } from '@kernel/event-bus';
import { getLogger } from '@kernel/logger';

const logger = getLogger('media-plugin');

interface MediaUploadedPayload {
  mediaId: string;
}

export function registerMediaPlugin(eventBus: EventBus) {
  eventBus.subscribe<MediaUploadedPayload>('media.uploaded', 'media-plugin', async (event) => {
    logger.info('Media uploaded', { mediaId: event.payload.mediaId });
  });
}
