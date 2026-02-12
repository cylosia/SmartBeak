
import { MediaAsset } from './entities/MediaAsset';

test('media upload lifecycle', () => {
  const asset = MediaAsset.createPending('abc-123', 'key', 'image/png');
  const uploaded = asset.markUploaded();
  expect(uploaded.status).toBe('uploaded');
  expect(uploaded.isUploaded()).toBe(true);
});

test('cannot mark already uploaded asset as uploaded again', () => {
  const asset = MediaAsset.createPending('abc-123', 'key', 'image/png');
  const uploaded = asset.markUploaded();
  expect(() => uploaded.markUploaded()).toThrow('Media already finalized');
});

test('upload preserves immutability', () => {
  const pending = MediaAsset.createPending('abc-123', 'key', 'image/png');
  const uploaded = pending.markUploaded();
  expect(pending.status).toBe('pending');
  expect(uploaded.status).toBe('uploaded');
  expect(pending).not.toBe(uploaded);
});
