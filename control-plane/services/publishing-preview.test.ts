
import { renderFacebookPost } from '../../plugins/publishing-adapters/facebook/render';

test('preview renderer matches adapter renderer', () => {
  const post = renderFacebookPost({
  title: 'Title',
  excerpt: 'Desc',
  url: 'https://example.com/x'
  });
  expect(post.message).toContain('Title');
  expect(post.message).toContain('https://example.com/x');
});
