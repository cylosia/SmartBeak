
import { VercelAdapter } from '../../src/adapters/vercel/VercelAdapter';

// P1-FIX: Store original fetch and restore it after each test.
// Setting global.fetch at module scope without cleanup contaminates every other
// test file processed in the same Jest worker with a stale mock.
const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({ id: 'deploy_1' }),
    text: async () => JSON.stringify({ id: 'deploy_1' }),
  } as unknown as Response);
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

test('Vercel adapter triggers deploy', async () => {
  const adapter = new VercelAdapter('token');
  const res = await adapter.triggerDeploy('proj', {});
  // P1-FIX: Assert the response shape explicitly rather than casting with `as any`.
  // The cast silences TypeScript and hides property-name mismatches at compile time.
  expect(res).toBeDefined();
  expect(res).toHaveProperty('id');
  expect((res as { id: string })['id']).toBe('deploy_1');
});
