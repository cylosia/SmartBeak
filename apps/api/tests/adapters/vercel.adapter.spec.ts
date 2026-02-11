
import { vi } from 'vitest';
import { VercelAdapter } from '../../src/adapters/vercel/VercelAdapter';

global.fetch = vi.fn().mockResolvedValue({
  ok: true,
  json: async () => ({ id: 'deploy_1' })
}) as any;

test('Vercel adapter triggers deploy', async () => {
  const adapter = new VercelAdapter('token');
  const res = await adapter.triggerDeploy('proj', {}) as { id: string };
  expect(res.id).toBe('deploy_1');
});
