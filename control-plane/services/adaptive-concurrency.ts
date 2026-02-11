export interface ConcurrencySignals {
  backlog: number;
  errorRate: number; // 0..1
}

/**
* Computes the optimal concurrency level based on signals.
* @param base - The base concurrency level
* @param signals - The concurrency signals (backlog and error rate)
* @returns The computed concurrency level (minimum 1)
*/
export function computeConcurrency(
  base: number,
  signals: ConcurrencySignals
): number {
  // Input validation
  if (typeof base !== 'number' || !Number.isFinite(base) || base < 1) {
  throw new Error('Invalid base concurrency: must be a positive number');
  }
  if (typeof signals.backlog !== 'number' || !Number.isFinite(signals.backlog)) {
  throw new Error('Invalid backlog: must be a number');
  }
  if (typeof signals.errorRate !== 'number' || !Number.isFinite(signals.errorRate)) {
  throw new Error('Invalid errorRate: must be a number');
  }
  if (signals.errorRate < 0 || signals.errorRate > 1) {
  throw new Error('Invalid errorRate: must be between 0 and 1');
  }

  let c = base;

  if (signals.backlog > 100) c += 5;
  if (signals.backlog > 500) c += 10;

  if (signals.errorRate > 0.05) c = Math.max(1, c - 5);
  if (signals.errorRate > 0.2) c = Math.max(1, c - 10);

  return Math.max(1, Math.floor(c));
}
