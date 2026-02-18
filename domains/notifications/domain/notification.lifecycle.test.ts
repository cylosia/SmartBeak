
import { Notification } from './entities/Notification';

test('notification lifecycle: pending → sending → delivered', () => {
  const n = Notification.create('1', 'o', 'u', 'email', 't', {});
  expect(n['status']).toBe('pending');

  const started = n.start();
  expect(started['status']).toBe('sending');

  const succeeded = started.succeed();
  expect(succeeded['status']).toBe('delivered');
  expect(succeeded.isTerminal()).toBe(true);
  expect(succeeded.canRetry()).toBe(false);
});

test('notification lifecycle: pending → sending → failed → pending (retry)', () => {
  const n = Notification.create('2', 'o', 'u', 'email', 't', {});
  const started = n.start();
  const failed = started.fail();
  expect(failed['status']).toBe('failed');
  expect(failed.isTerminal()).toBe(false);
  expect(failed.canRetry()).toBe(true);

  const retried = failed.start();
  expect(retried['status']).toBe('sending');
});

test('notification lifecycle: pending → cancelled', () => {
  const n = Notification.create('3', 'o', 'u', 'email', 't', {});
  const cancelled = n.cancel();
  expect(cancelled['status']).toBe('cancelled');
  expect(cancelled.isTerminal()).toBe(true);
  expect(cancelled.canRetry()).toBe(false);
});

test('notification lifecycle: sending → cancelled', () => {
  const n = Notification.create('4', 'o', 'u', 'email', 't', {});
  const started = n.start();
  const cancelled = started.cancel();
  expect(cancelled['status']).toBe('cancelled');
  expect(cancelled.isTerminal()).toBe(true);
});

test('notification rejects invalid transitions', () => {
  const n = Notification.create('5', 'o', 'u', 'email', 't', {});
  expect(() => n.succeed()).toThrow();
  expect(() => n.fail()).toThrow();

  const delivered = n.start().succeed();
  expect(() => delivered.start()).toThrow();
  expect(() => delivered.fail()).toThrow();
  expect(() => delivered.cancel()).toThrow();

  const cancelled = n.cancel();
  expect(() => cancelled.start()).toThrow();
  expect(() => cancelled.succeed()).toThrow();
  expect(() => cancelled.cancel()).toThrow();
});

test('create() rejects non-pending initial status', () => {
  expect(() => Notification.create('6', 'o', 'u', 'email', 't', {}, 'sending' as 'pending')).toThrow('Initial status must be pending');
});

test('reconstitute() allows any status', () => {
  const n = Notification.reconstitute('7', 'o', 'u', 'email', 't', {}, 'delivered');
  expect(n['status']).toBe('delivered');
  expect(n.isTerminal()).toBe(true);
});

test('isPending and isSending checks', () => {
  const n = Notification.create('8', 'o', 'u', 'email', 't', {});
  expect(n.isPending()).toBe(true);
  expect(n.isSending()).toBe(false);

  const started = n.start();
  expect(started.isPending()).toBe(false);
  expect(started.isSending()).toBe(true);
});
