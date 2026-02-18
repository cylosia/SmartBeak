
import { ContentItem } from './entities/ContentItem';

test('revision captures immutable snapshot', () => {
  const item = ContentItem.createDraft('c01', 'domain-1', 't', 'b');
  const snap = { title: item.title, body: item.body };
  const result = item.updateDraft('t2', 'b2');
  expect(snap.title).toBe('t');
  expect(result.title).toBe('t2');
});
