
import { CONTENT_PUBLISHED_V1 } from './content-published.v1';

test('content.published v1 contract is stable', () => {
  expect(CONTENT_PUBLISHED_V1.name).toBe('content.published');
  expect(CONTENT_PUBLISHED_V1.version).toBe(1);
});
