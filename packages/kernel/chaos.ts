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

  // P2-FIX: Validate rate is within [0, 1].  Values outside this range cause
  // always-throw (rate > 1) or never-throw (rate < 0) behaviour that is
  // impossible to distinguish from a bug in the caller.
  if (rate < 0 || rate > 1) {
  throw new RangeError(`maybeChaos: rate must be between 0 and 1, got ${rate}`);
  }

  if (Math.random() < rate) {
  throw new Error('Injected chaos failure');
  }
}
