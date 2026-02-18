
import { LinkedInAdapter } from '../../src/adapters/linkedin/LinkedInAdapter';

// Mock fetch to prevent real HTTP requests to LinkedIn API
const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

test('LinkedIn adapter creates company post', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    status: 201,
    json: async () => ({ status: 'created', id: 'post-123' }),
  });

  const adapter = new LinkedInAdapter('test-token');
  const res = await adapter.createCompanyPost('org123', { text: 'Hello' }) as { status: string; id: string };

  expect(res).toBeDefined();
  expect(res.status).toBe('created');
  expect(res.id).toBe('post-123');
  expect(mockFetch).toHaveBeenCalledTimes(1);
});

test('LinkedIn adapter handles API errors', async () => {
  mockFetch.mockResolvedValueOnce({
    ok: false,
    status: 401,
    json: async () => ({ message: 'Unauthorized' }),
  });

  const adapter = new LinkedInAdapter('bad-token');
  await expect(
    adapter.createCompanyPost('org123', { text: 'Hello' })
  ).rejects.toThrow();
});
