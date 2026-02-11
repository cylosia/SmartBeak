
import { vi } from 'vitest';

vi.mock('node-fetch', () => ({
  default: vi.fn()
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: 'person1' }),
    })
    .mockResolvedValueOnce({
      ok: true,
      json: async () => ({}),
      headers: new Map([['x-restli-id', 'post1']]),
    }),
}));

import { LinkedInAdapter } from '../../src/adapters/linkedin/LinkedInAdapter';

test('LinkedIn adapter creates company post', async () => {
  const adapter = new LinkedInAdapter('token');
  const res = await adapter.createCompanyPost('org123', { text: 'Hello' }) as { status: string; id: string };

  expect(res.status).toBe('created');
});
