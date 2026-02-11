

import { CONTENT_PUBLISHED_V1 } from '@types/events/content-published.v1';
test('analytics plugin supports content.published v1', () => {
  expect(CONTENT_PUBLISHED_V1.version).toBe(1);
});
