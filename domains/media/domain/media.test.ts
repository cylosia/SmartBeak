
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

// T-P1-3 FIX: Test reconstitute preserves all fields and status
test('reconstitute preserves all fields', () => {
  const asset = MediaAsset.reconstitute('media-999', 'key/path', 'audio/wav', 'uploaded');
  expect(asset.id).toBe('media-999');
  expect(asset.storageKey).toBe('key/path');
  expect(asset.mimeType).toBe('audio/wav');
  expect(asset.status).toBe('uploaded');
  expect(asset.isUploaded()).toBe(true);
  expect(asset.isPending()).toBe(false);
});

test('reconstitute with pending status allows markUploaded', () => {
  const asset = MediaAsset.reconstitute('media-abc', 'key/x', 'image/png', 'pending');
  expect(asset.isPending()).toBe(true);
  const uploaded = asset.markUploaded();
  expect(uploaded.isUploaded()).toBe(true);
});
