
import { ContentItem } from './entities/ContentItem';

test('draft -> update -> publish lifecycle', () => {
  const item = ContentItem.createDraft('1', 'domain-1', 'Title', 'Body');
  const result = item.publish();
  expect(result.item["status"]).toBe('published');
  expect(result.event["name"]).toBe('content.published');
});
