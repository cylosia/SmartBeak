
import { adaptPodcastMetadata } from '../../src/adapters/podcast/PodcastMetadataAdapter';

test('Podcast metadata adapter normalizes metadata', () => {
  const res = adaptPodcastMetadata({ title: 'Episode One', description: 'A test episode description' });
  expect(res.title).toBe('Episode One');
  expect(res.description).toBe('A test episode description');
});
