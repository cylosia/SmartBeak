/**
* Chaos engineering helper - randomly throws errors for testing resilience
* @param rate - Probability of throwing an error (0-1)
* @throws Error when chaos is triggered
*/
export function maybeChaos(rate = 0.1): void {
  // P1-9 FIX: Never inject chaos in production. Previously no env guard existed,
  // meaning any code path calling maybeChaos() would randomly fail 10% of the time
  // in production.
  // P2-044 FIX: Case-sensitive check allows chaos to run in 'Production' or
  // 'PRODUCTION'. Use .toLowerCase() for robust matching, and also guard
  // against an empty/missing NODE_ENV (default-allow-chaos is unsafe).
  const env = (process.env['NODE_ENV'] || '').toLowerCase();
  if (env === 'production' || env === '') return;

  if (Math.random() < rate) {
  throw new Error('Injected chaos failure');
  }
}
