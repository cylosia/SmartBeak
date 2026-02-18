
import { ContentItem } from './entities/ContentItem';

test('content publish changes status', () => {
  const item = ContentItem.createDraft('c01', 'domain-1', 't', 'b');
  const result = item.publish();
  expect(result.item.status).toBe('published');
});
