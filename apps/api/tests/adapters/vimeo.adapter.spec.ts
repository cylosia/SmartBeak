
import { VimeoAdapter } from '../../src/adapters/vimeo/VimeoAdapter';

// P1-FIX: Store original fetch and restore it after each test.
// Setting global.fetch at module scope without cleanup contaminates every other
// test file processed in the same Jest worker with a stale mock.
const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => ({}),
    text: async () => '{}',
  } as unknown as Response);
});

afterEach(() => {
  global.fetch = originalFetch;
  jest.clearAllMocks();
});

test('Vimeo metadata update succeeds', async () => {
  const adapter = new VimeoAdapter('token');
  await adapter.updateMetadata('vid', { name: 'Test' });
});
