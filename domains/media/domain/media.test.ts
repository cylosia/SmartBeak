
import { MediaAsset } from './entities/MediaAsset';

test('media asset stores data', () => {
  const asset = MediaAsset.createPending('1', 'url', 'image/png');
  expect(asset.mimeType).toBe('image/png');
});
