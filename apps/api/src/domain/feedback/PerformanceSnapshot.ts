/**
* Performance metric value type
* Supported types for performance metrics
*/
export type MetricValue = number | string | boolean | null | undefined;

/**
* Performance snapshot entity
* Captures metrics for a specific entity at a point in time
*/
export class PerformanceSnapshot {
  /**
  * Creates a PerformanceSnapshot instance
  * @param entityType - Type of entity being measured (e.g., 'content', 'user')
  * @param metrics - Key-value map of performance metrics
  */
  constructor(
  readonly entityType: string,
  readonly metrics: Record<string, MetricValue>
  ) {}
}
