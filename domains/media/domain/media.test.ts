
import { MediaAsset } from './entities/MediaAsset';

test('media asset stores data', () => {
  const asset = MediaAsset.createPending('id1', 'url', 'image/png');
  expect(asset.mimeType).toBe('image/png');
});
