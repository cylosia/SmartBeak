/**
* PublishAttempt - Immutable domain entity representing a single publishing attempt
*
* Tracks the outcome of trying to publish content to a target platform.
* Each attempt has a unique sequence number within its parent publishing job.
*/
export class PublishAttempt {
  private constructor(
  public readonly id: string,
  public readonly publishingJobId: string,
  public readonly attemptNumber: number,
  public readonly status: 'success' | 'failure',
  public readonly error?: string
  ) {
  if (attemptNumber < 1) {
    throw new Error('attemptNumber must be >= 1');
  }
  }

  /**
  * Create a new publish attempt
  */
  static create(
  id: string,
  publishingJobId: string,
  attemptNumber: number,
  status: 'success' | 'failure',
  error?: string
  ): PublishAttempt {
  return new PublishAttempt(id, publishingJobId, attemptNumber, status, error);
  }

  /**
  * Reconstitute from persistence
  */
  static reconstitute(
  id: string,
  publishingJobId: string,
  attemptNumber: number,
  status: 'success' | 'failure',
  error?: string
  ): PublishAttempt {
  return new PublishAttempt(id, publishingJobId, attemptNumber, status, error);
  }
}
