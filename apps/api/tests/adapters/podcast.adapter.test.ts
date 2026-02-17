
import { adaptPodcastMetadata } from '../../src/adapters/podcast/PodcastMetadataAdapter';

test('Podcast metadata adapter returns status', async () => {
  const res = await adaptPodcastMetadata('ep1', { title: 'x' });
  expect(res.status).toBe('metadata_updated');
});
