

import { CONTENT_PUBLISHED_V1 } from '@types/events/content-published.v1';
test('publishing plugin supports content.published v1', () => {
  expect(CONTENT_PUBLISHED_V1["name"]).toBe('content.published');
});
