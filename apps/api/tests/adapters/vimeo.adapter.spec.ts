
import { vi } from 'vitest';

vi.mock('node-fetch', () => ({
  default: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
}));

import { VimeoAdapter } from '../../src/adapters/vimeo/VimeoAdapter';

test('Vimeo metadata update succeeds', async () => {
  const adapter = new VimeoAdapter('token');
  await adapter.updateMetadata('vid', { name: 'Test' });
});
