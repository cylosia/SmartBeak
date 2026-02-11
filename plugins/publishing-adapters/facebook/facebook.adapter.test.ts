

import { renderFacebookPost } from './render';

test('facebook renderer formats message', () => {
  const post = renderFacebookPost({
  title: 'Hello',
  excerpt: 'World',
  url: 'https://example.com'
  });
  expect(post["message"]).toContain('Hello');
  expect(post["message"]).toContain('https://example.com');
});
