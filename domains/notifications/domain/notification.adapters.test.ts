
import { EmailAdapter } from '../../../plugins/notification-adapters/email-adapter';

test('email adapter exists', () => {
  const a = new EmailAdapter();
  expect(a).toBeDefined();
});
