export interface QueueConfig {
  maxConcurrency: number;
  maxInFlight: number;
}

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  maxConcurrency: 10,
  maxInFlight: 100
};
