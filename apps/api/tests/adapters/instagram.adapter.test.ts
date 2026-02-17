
import { InstagramAdapter } from '../../src/adapters/instagram/InstagramAdapter';

global.fetch = jest.fn()
  .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'c1' }) })
  .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'p1' }) }) as any;

test('Instagram image publish succeeds', async () => {
  const adapter = new InstagramAdapter('token', 'user1');
  const res = await adapter.publishImage({ imageUrl: 'x', caption: 'y' }) as { id: string };
  expect(res.id).toBe('p1');
});
