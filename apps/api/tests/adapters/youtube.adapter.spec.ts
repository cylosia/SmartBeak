
import { YouTubeAdapter } from '../../src/adapters/youtube/YouTubeAdapter';

global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) }) as any;

test('YouTube metadata update succeeds', async () => {
  const adapter = new YouTubeAdapter('token');
  await adapter.updateMetadata('vid123', { title: 'Test' });
});
