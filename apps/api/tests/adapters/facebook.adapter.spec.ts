
import { FacebookAdapter } from '../../src/adapters/facebook/FacebookAdapter';

// M27 FIX: Use jest.spyOn + afterEach cleanup instead of a bare global.fetch assignment.
// The bare assignment was never cleaned up, polluting the global fetch for subsequent
// test files that run in the same Jest worker process.
const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: 'fb_post_1' }),
  }) as unknown as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
});

test('Facebook adapter publishes a post', async () => {
  const adapter = new FacebookAdapter('token');
  // P0 FIX: Use a numeric-only pageId. validatePublishInput() enforces /^\d+$/
  // so 'page1' would throw "Page ID must be a numeric string". Use '123456'.
  const res = await adapter.publishPagePost('123456', 'hello') as { id: string };
  expect(res.id).toBe('fb_post_1');
});
