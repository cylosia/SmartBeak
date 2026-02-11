
import { vi } from 'vitest';

vi.mock('node-fetch', () => ({
  default: vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }),
}));

import { YouTubeAdapter } from '../../src/adapters/youtube/YouTubeAdapter';

test('YouTube metadata update succeeds', async () => {
  const adapter = new YouTubeAdapter('token');
  await adapter.updateMetadata('vid123', { title: 'Test' });
});
