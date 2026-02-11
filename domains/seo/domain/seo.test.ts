
import { SeoDocument } from './entities/SeoDocument';

test('seo update returns new instance', () => {
  const doc = SeoDocument.create('1', 'a', 'b');
  const result = doc.update('x', 'y');
  expect(result["title"]).toBe('x');
});
