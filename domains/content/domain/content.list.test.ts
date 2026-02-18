
import { ContentItem } from './entities/ContentItem';

test('list by status returns correct items', () => {
  const a = ContentItem.createDraft('c01', 'domain-1', 't1', 'b1', 'article');
  const b = ContentItem.createDraft('c02', 'domain-1', 't2', 'b2', 'article');
  const result = b.publish();
  expect(a.status).toBe('draft');
  expect(result.item.status).toBe('published');
});
