
// P1-SSRF-MOCK FIX: Mock @security/ssrf before any imports that use it.
// Without this mock the real validateUrlWithDns() performs live DNS lookups,
// causing non-deterministic failures in offline CI environments.
jest.mock('@security/ssrf', () => ({
  validateUrlWithDns: jest.fn().mockResolvedValue({
    allowed: true,
    sanitizedUrl: 'https://example.com',
  }),
  validateUrl: jest.fn().mockReturnValue({
    allowed: true,
    sanitizedUrl: 'https://example.com',
  }),
}));

// Mock logger to suppress output during tests
jest.mock('@kernel/logger', () => ({
  getLogger: () => ({
    error: jest.fn(),
    warn: jest.fn(),
    info: jest.fn(),
  }),
}));

// Mock metrics collector
jest.mock('@kernel/request', () => ({
  MetricsCollector: class {
    recordError = jest.fn();
    recordLatency = jest.fn();
  },
}));

// Mock config defaults
jest.mock('@config', () => ({
  DEFAULT_TIMEOUTS: { medium: 30000 },
}));

// Mock retry utility to call the function directly without retries
jest.mock('../../src/utils/retry', () => ({
  withRetry: jest.fn((fn: () => Promise<unknown>) => fn()),
}));

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
  const responseBody = JSON.stringify({ id: 123 });
  (fetch as any).mockResolvedValue({
    ok: true,
    // Production code calls assertResponseSizeOk(response) → response.headers.get()
    // then response.text() + JSON.parse() rather than response.json().
    headers: { get: jest.fn().mockReturnValue(null) },
    text: async () => responseBody,
    json: async () => ({ id: 123 }),
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
