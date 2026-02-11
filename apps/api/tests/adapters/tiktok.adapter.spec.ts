
import { TikTokAdapter, TikTokVideo } from '../../src/adapters/tiktok/TikTokAdapter';

test('TikTok adapter returns queued status', async () => {
  const adapter = new TikTokAdapter('token');
  const video: TikTokVideo = { title: 'Test', videoFile: Buffer.from('test') };
  const res = await adapter.publishVideo(video);
  expect(res.status).toBe('processing');
});
