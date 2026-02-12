/**
* Chaos engineering helper - randomly throws errors for testing resilience
* @param rate - Probability of throwing an error (0-1)
* @throws Error when chaos is triggered
*/
export function maybeChaos(rate = 0.1): void {
  // P1-9 FIX: Never inject chaos in production. Previously no env guard existed,
  // meaning any code path calling maybeChaos() would randomly fail 10% of the time
  // in production.
  if (process.env['NODE_ENV'] === 'production') return;

  if (Math.random() < rate) {
  throw new Error('Injected chaos failure');
  }
}
