
import { Notification } from './entities/Notification';

test('notification lifecycle', () => {
  const n = Notification.create('1','o','u','email','t',{});
  const started = n.start();
  expect(started["status"]).toBe('sending');
  const succeeded = started.succeed();
  expect(succeeded["status"]).toBe('delivered');
});
