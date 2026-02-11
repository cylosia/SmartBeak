
import { vi } from 'vitest';
import { PinterestAdapter } from '../../src/adapters/pinterest/PinterestAdapter';

global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'pin1' }) }) as any;

test('Pinterest pin creation succeeds', async () => {
  const adapter = new PinterestAdapter('token');
  const res = await adapter.createPin('board1', {
  title: 't',
  description: 'd',
  link: 'https://example.com',
  imageUrl: 'https://example.com/img.jpg'
  }) as { id: string };
  expect(res.id).toBe('pin1');
});
