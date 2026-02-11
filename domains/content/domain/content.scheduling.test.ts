
import { ContentItem } from './entities/ContentItem';

test('schedule invalidated on edit (Q1=C)', () => {
  const item = ContentItem.createDraft('1', 'domain-1', 't', 'b');
  const scheduled = item.schedule(new Date(Date.now() + 10000));
  expect(scheduled.item["status"]).toBe('scheduled');
  const updated = scheduled.item.updateDraft('t2', 'b2');
  expect(updated.item["status"]).toBe('draft');
});
