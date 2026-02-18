
import { InstagramAdapter } from '../../src/adapters/instagram/InstagramAdapter';

// Set up and tear down per-test so mock state cannot bleed across tests.
// Previously the mock was set at module scope, meaning any test running AFTER
// this one in the same Jest worker would see an exhausted mockResolvedValueOnce
// chain and get `undefined` back from fetch.
beforeEach(() => {
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'c1' }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'p1' }) }) as unknown as typeof fetch;
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('Instagram image publish succeeds', async () => {
  const adapter = new InstagramAdapter('token', 'user1');
  const res = await adapter.publishImage({ imageUrl: 'x', caption: 'y' }) as { id: string };
  expect(res.id).toBe('p1');
});
