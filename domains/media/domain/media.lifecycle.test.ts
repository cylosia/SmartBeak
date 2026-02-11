
import { MediaAsset } from './entities/MediaAsset';

test('media upload lifecycle', () => {
  const asset = MediaAsset.createPending('id1', 'key', 'image/png');
  const uploaded = asset.markUploaded();
  expect(uploaded["status"]).toBe('uploaded');
});
