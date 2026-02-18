
import { SoundCloudAdapter } from '../../src/adapters/soundcloud/SoundCloudAdapter';

// Mock node-fetch — the adapter imports fetch from 'node-fetch', not from the global.
// global.fetch would not intercept node-fetch calls.
jest.mock('node-fetch', () => ({
  __esModule: true,
  default: jest.fn().mockResolvedValue({
    ok: true,
    headers: { get: (_: string) => null },
    json: async () => ({
      id: 1,
      uri: 'https://api.soundcloud.com/tracks/1',
      title: 'Test Track',
    }),
  }),
}));

test('SoundCloud upload succeeds', async () => {
  const adapter = new SoundCloudAdapter('token');
  // Pass required SoundCloudUploadInput fields: title (string) and asset_data (Buffer)
  const res = await adapter.uploadTrack({
    title: 'Test Track',
    asset_data: Buffer.from('audio data'),
  });
  expect(res.id).toBe(1);
});
