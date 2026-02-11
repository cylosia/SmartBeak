
import { vi } from 'vitest';

vi.mock('node-fetch', () => ({
  default: vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'track1' }) }),
}));

import { SoundCloudAdapter } from '../../src/adapters/soundcloud/SoundCloudAdapter';

test('SoundCloud upload succeeds', async () => {
  const adapter = new SoundCloudAdapter('token');
  const res = await adapter.uploadTrack({ formData: {} }) as { id: string };
  expect(res.id).toBe('track1');
});
