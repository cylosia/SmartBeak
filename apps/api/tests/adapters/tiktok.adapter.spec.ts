
import { TikTokAdapter, TikTokVideo } from '../../src/adapters/tiktok/TikTokAdapter';

// P2-10 FIX: Mock node-fetch to prevent real network calls in tests
jest.mock('node-fetch', () => {
  const mockFetch = jest.fn();
  return { __esModule: true, default: mockFetch };
});

import fetch from 'node-fetch';
const mockFetch = fetch as jest.MockedFunction<typeof fetch>;

function mockJsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as import('node-fetch').Response;
}

test('TikTok adapter returns queued status', async () => {
  // Mock the publish endpoint (POST /v2/post/publish/video/init/)
  mockFetch.mockResolvedValueOnce(
    mockJsonResponse({
      data: { publish_id: 'mock-publish-id' },
      error: { code: 'ok', message: '' },
    })
  );

  const adapter = new TikTokAdapter('token');
  const video: TikTokVideo = { title: 'Test', videoFile: Buffer.from('test') };
  const res = await adapter.publishVideo(video);
  expect(res.status).toBe('processing');
  expect(mockFetch).toHaveBeenCalled();
});
