
import { withTimeout, withCircuitBreaker } from '../../src/utils/resilience';

// P3-FIX (P3-6): Wrap tests in a describe block so they can be targeted with
// --testNamePattern (e.g. jest --testNamePattern "resilience") and clearly scoped
// in CI output.
describe('resilience / breaker', () => {
  test('withTimeout rejects slow promise', async () => {
    const slow = new Promise(resolve => setTimeout(resolve, 50));
    await expect(withTimeout(slow, 10)).rejects.toThrow('Timeout');
  });

  test('circuit breaker opens after failures', async () => {
    let _calls = 0;
    const fn = async () => {
    _calls++;
    throw new Error('fail');
    };

    const wrapped = withCircuitBreaker(fn, 2, 'test_adapter');

    await expect(wrapped()).rejects.toThrow();
    await expect(wrapped()).rejects.toThrow();
    await expect(wrapped()).rejects.toThrow('Circuit open');
  });
});
