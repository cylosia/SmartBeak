
import { vi } from 'vitest';

vi.mock('node-fetch', () => ({
  default: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'pin1' }) }),
}));

import { PinterestAdapter } from '../../src/adapters/pinterest/PinterestAdapter';

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
