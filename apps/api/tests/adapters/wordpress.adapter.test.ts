
import { createWordPressPost } from '../../src/adapters/wordpress/WordPressAdapter';

// P3-8 FIX: Save and restore original fetch to prevent global pollution
const originalFetch = global.fetch;
global.fetch = jest.fn();

afterAll(() => {
  global.fetch = originalFetch;
});

afterEach(() => {
  (fetch as any).mockReset();
});

test('creates post successfully', async () => {
  (fetch as any).mockResolvedValue({
    ok: true,
    json: async () => ({ id: 123 })
  });

  const res = await createWordPressPost({
    baseUrl: 'https://example.com',
    // P3-6 FIX: Use 'password' (matching WordPressConfig interface) instead of 'applicationPassword'
    username: 'user',
    password: 'pass'
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
    status: 403,
    statusText: 'Forbidden',
    text: async () => 'Forbidden'
  });

  await expect(
    createWordPressPost({
      baseUrl: 'https://example.com',
      // P3-6 FIX: Use 'password' matching WordPressConfig interface
      username: 'user',
      password: 'pass'
    }, {
      title: 'Test',
      content: 'Hello',
      status: 'draft'
    })
    // P3-7 FIX: Match actual error message from createWordPressPost
  ).rejects.toThrow('Failed to create WordPress post');
});
