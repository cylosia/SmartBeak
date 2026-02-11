
import { vi } from 'vitest';

vi.mock('node-fetch', () => ({
  default: vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ id: 'deploy_1' }),
  }),
}));

import { VercelAdapter } from '../../src/adapters/vercel/VercelAdapter';

test('Vercel adapter triggers deploy', async () => {
  const adapter = new VercelAdapter('token');
  const res = await adapter.triggerDeploy('proj', {}) as { id: string };
  expect(res.id).toBe('deploy_1');
});
