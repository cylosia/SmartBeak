
import { vi } from 'vitest';
import { FacebookAdapter } from '../../src/adapters/facebook/FacebookAdapter';

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ id: 'fb_post_1' })
}) as any;

test('Facebook adapter publishes a post', async () => {
  const adapter = new FacebookAdapter('token');
  const res = await adapter.publishPagePost('page1', 'hello') as { id: string };
  expect(res.id).toBe('fb_post_1');
});
