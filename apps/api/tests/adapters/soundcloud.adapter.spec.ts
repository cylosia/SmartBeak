
import { vi } from 'vitest';
import { SoundCloudAdapter } from '../../src/adapters/soundcloud/SoundCloudAdapter';

global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'track1' }) }) as any;

test('SoundCloud upload succeeds', async () => {
  const adapter = new SoundCloudAdapter('token');
  const res = await adapter.uploadTrack({ formData: {} }) as { id: string };
  expect(res.id).toBe('track1');
});
