
import { NotificationPreference } from './entities/NotificationPreference';

test('setFrequency returns new instance with updated frequency', () => {
  const pref = NotificationPreference.create('1', 'u', 'email', true, 'immediate');
  const updated = pref.setFrequency('daily');
  expect(updated.frequency).toBe('daily');
  expect(pref.frequency).toBe('immediate'); // original unchanged
});

test('setFrequency validates the frequency value at runtime', () => {
  const pref = NotificationPreference.create('1', 'u', 'email', true, 'immediate');
  expect(() => pref.setFrequency('hourly' as 'immediate')).toThrow('Invalid frequency');
});

test('enable / disable toggles enabled state immutably', () => {
  const pref = NotificationPreference.create('1', 'u', 'email', true, 'immediate');
  expect(pref.isEnabled()).toBe(true);

  const disabled = pref.disable();
  expect(disabled.isEnabled()).toBe(false);
  expect(pref.isEnabled()).toBe(true); // original unchanged

  const reenabled = disabled.enable();
  expect(reenabled.isEnabled()).toBe(true);
});

test('disable() is idempotent', () => {
  const pref = NotificationPreference.create('1', 'u', 'email', false, 'daily');
  expect(pref.disable()).toBe(pref); // returns same instance
});

test('enable() is idempotent', () => {
  const pref = NotificationPreference.create('1', 'u', 'email', true, 'daily');
  expect(pref.enable()).toBe(pref); // returns same instance
});

test('create() validates frequency', () => {
  expect(() => NotificationPreference.create('1', 'u', 'email', true, 'monthly' as 'immediate')).toThrow('Invalid frequency');
});

test('reconstitute() validates frequency', () => {
  expect(() => NotificationPreference.reconstitute('1', 'u', 'email', true, 'never' as 'immediate')).toThrow('Invalid frequency');
});
