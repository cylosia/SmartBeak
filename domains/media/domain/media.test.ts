
import { MediaAsset } from './entities/MediaAsset';

test('media asset stores data', () => {
  const asset = MediaAsset.createPending('abc-123', 'url', 'image/png');
  expect(asset.mimeType).toBe('image/png');
});

test('media asset rejects invalid id', () => {
  expect(() => MediaAsset.createPending('1', 'url', 'image/png')).toThrow(
    'MediaAsset requires a valid id'
  );
});

test('media asset starts in pending status', () => {
  const asset = MediaAsset.createPending('abc-123', 'storage/key', 'video/mp4');
  expect(asset.status).toBe('pending');
  expect(asset.isPending()).toBe(true);
  expect(asset.isUploaded()).toBe(false);
});
