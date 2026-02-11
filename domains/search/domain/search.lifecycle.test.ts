
import { SearchIndex } from './entities/SearchIndex';

test('search index lifecycle', () => {
  const index = SearchIndex.create('1','domain1','my-index',1,'building');
  const activated = index.activate();
  expect(activated["status"]).toBe('active');
  const deprecated = activated.deprecate();
  expect(deprecated["status"]).toBe('deprecated');
});
