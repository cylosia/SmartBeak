
import { ContentItem } from './entities/ContentItem';

test('revision captures immutable snapshot', () => {
  const item = ContentItem.createDraft('id1', 'domain-1', 't', 'b');
  const snap = { title: item["title"], body: item["body"] };
  const result = item.updateDraft('t2','b2');
  expect(snap["title"]).toBe('t');
  expect(result.item["title"]).toBe('t2');
});
