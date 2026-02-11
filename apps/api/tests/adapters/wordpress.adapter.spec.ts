
import { createWordPressPost } from '../../src/adapters/wordpress/WordPressAdapter';

global.fetch = jest.fn();

test('creates post successfully', async () => {
  (fetch as any).mockResolvedValue({
  ok: true,
  json: async () => ({ id: 123 })
  });

  const res = await createWordPressPost({
  baseUrl: 'https://example.com',
  username: 'user',
  applicationPassword: 'pass'
  }, {
  title: 'Test',
  content: 'Hello',
  status: 'draft'
  }) as { id: number };

  expect(res.id).toBe(123);
});

test('throws on wordpress error', async () => {
  (fetch as any).mockResolvedValue({
  ok: false,
  text: async () => 'Forbidden'
  });

  await expect(
  createWordPressPost({
    baseUrl: 'https://example.com',
    username: 'user',
    applicationPassword: 'pass'
  }, {
    title: 'Test',
    content: 'Hello',
    status: 'draft'
  })
  ).rejects.toThrow('WordPress publish failed');
});
