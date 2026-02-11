/**
* Chaos engineering helper - randomly throws errors for testing resilience
* @param rate - Probability of throwing an error (0-1)
* @throws Error when chaos is triggered
*/
export function maybeChaos(rate = 0.1): void {
  if (Math.random() < rate) {
  throw new Error('Injected chaos failure');
  }
}
