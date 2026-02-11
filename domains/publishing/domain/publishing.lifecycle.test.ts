
import { PublishingJob } from './entities/PublishingJob';

test('publishing job lifecycle', () => {
  const job = PublishingJob.create('id1','d','c','t');
  const started = job.start();
  expect(started["status"]).toBe('publishing');
  const succeeded = started.succeed();
  expect(succeeded["status"]).toBe('published');
});
