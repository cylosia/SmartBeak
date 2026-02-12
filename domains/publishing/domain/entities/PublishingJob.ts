/**
* PublishingJob Domain Entity
*
* Represents a content publishing job with a state machine for tracking
* publication status. Jobs follow the lifecycle: pending → publishing → published/failed.
*
* This entity is immutable - all state changes return new instances.
*
* @module domains/publishing/domain/entities/PublishingJob
*/

export type PublishingStatus = 'pending' | 'publishing' | 'published' | 'failed';

export interface PublishingJobState {
  readonly id: string;
  readonly domainId: string;
  readonly contentId: string;
  readonly targetId: string;
  readonly status: PublishingStatus;
  readonly errorMessage?: string | undefined;
  readonly startedAt?: Date | undefined;
  readonly completedAt?: Date | undefined;
  readonly attemptCount: number;
}

/**
* PublishingJob - Immutable domain entity with state machine validation
*
* State transitions:
*   pending → publishing → published
*                    ↘ failed → pending (retry)
*/
export class PublishingJob {
  private static readonly VALID_TRANSITIONS: Record<PublishingStatus, PublishingStatus[]> = {
  pending: ['publishing'],
  publishing: ['published', 'failed'],
  published: [], // Terminal state
  failed: ['pending'], // Allow retry
  };

  private constructor(private readonly state: PublishingJobState) {}

  // Factory method for creating new jobs
  static create(
    id: string,
    domainId: string,
    contentId: string,
    targetId: string
  ): PublishingJob {
    // P1-FIX: Added input validation for entity creation
    if (!id || typeof id !== 'string' || id.length < 3) {
      throw new Error('PublishingJob requires a valid id (string with at least 3 characters)');
    }
    if (!domainId || typeof domainId !== 'string') {
      throw new Error('PublishingJob requires a valid domainId');
    }
    if (!contentId || typeof contentId !== 'string') {
      throw new Error('PublishingJob requires a valid contentId');
    }
    if (!targetId || typeof targetId !== 'string') {
      throw new Error('PublishingJob requires a valid targetId');
    }
    
    return new PublishingJob({
      id,
      domainId,
      contentId,
      targetId,
      status: 'pending',
      attemptCount: 0,
    });
  }

  // Reconstitute from persistence
  static reconstitute(state: PublishingJobState): PublishingJob {
  return new PublishingJob(state);
  }

  // Getters for immutable access
  get id(): string { return this.state["id"]; }
  get domainId(): string { return this.state.domainId; }
  get contentId(): string { return this.state.contentId; }
  get targetId(): string { return this.state.targetId; }
  get status(): PublishingStatus { return this.state["status"]; }
  get errorMessage(): string | undefined { return this.state.errorMessage; }
  get startedAt(): Date | undefined { return this.state.startedAt; }
  get completedAt(): Date | undefined { return this.state.completedAt; }
  get attemptCount(): number { return this.state.attemptCount; }

  /**
  * Start publishing - transitions from pending to publishing
  */
  start(): PublishingJob {
  this.validateTransition('publishing');

  return new PublishingJob({
    ...this.state,
    status: 'publishing',
    startedAt: new Date(),
    attemptCount: this.state.attemptCount + 1,
  });
  }

  /**
  * Mark as successfully published
  */
  succeed(): PublishingJob {
  this.validateTransition('published');

  return new PublishingJob({
    ...this.state,
    status: 'published',
    completedAt: new Date(),
  });
  }

  /**
  * Mark as failed with error context
  */
  fail(_errorMessage: string): PublishingJob {
  this.validateTransition('failed');

  return new PublishingJob({
    ...this.state,
    status: 'failed',
    completedAt: new Date(),
  });
  }

  /**
  * Reset to pending for retry (only from failed state)
  */
  retry(): PublishingJob {
  this.validateTransition('pending');

  return new PublishingJob({
    ...this.state,
    status: 'pending',
    errorMessage: undefined,
    startedAt: undefined,
    completedAt: undefined,
    attemptCount: 0,
  });
  }

  /**
  * Check if job can be retried
  */
  canRetry(): boolean {
  return this.state["status"] === 'failed';
  }

  /**
  * Check if job is in terminal state
  */
  isTerminal(): boolean {
  return this.state["status"] === 'published' || this.state["status"] === 'failed';
  }

  /**
  * Get state for persistence
  */
  toState(): PublishingJobState {
  return { ...this.state };
  }

  private validateTransition(to: PublishingStatus): void {
  const validTransitions = PublishingJob.VALID_TRANSITIONS[this.state["status"]];
  if (!validTransitions.includes(to)) {
    throw new Error(
    `Invalid state transition: cannot transition from '${this.state["status"]}' to '${to}'. ` +
    `Valid transitions from '${this.state["status"]}' are: ${validTransitions.join(', ') || 'none'}`
    );
  }
  }
}
