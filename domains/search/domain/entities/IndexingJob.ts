export type IndexingStatus = 'pending' | 'processing' | 'done' | 'failed';

// Valid state transitions
const VALID_TRANSITIONS: Record<IndexingStatus, IndexingStatus[]> = {
  pending: ['processing'],
  processing: ['done', 'failed'],
  done: [], // Terminal state
  failed: ['pending'], // Allow retry
};

/**
* IndexingJob - Immutable domain entity with state machine validation
*
* State transitions:
*   pending → processing → done
*                      ↘ failed → pending (retry)
*/
export class IndexingJob {
  private static readonly VALID_TRANSITIONS = VALID_TRANSITIONS;

  private constructor(
  public readonly id: string,
  public readonly indexId: string,
  public readonly contentId: string,
  public readonly action: 'index' | 'delete',
  public readonly status: IndexingStatus,
  public readonly attemptCount: number = 0
  ) {}

  /**
  * Create a new indexing job
  * @param id - Unique identifier
  * @param indexId - Search index ID
  * @param contentId - Content ID to index
  * @param action - Action type ('index' or 'delete')
  * @param status - Initial status
  * @param attemptCount - Number of attempts made
  * @returns New IndexingJob instance
  */
  static create(
  id: string,
  indexId: string,
  contentId: string,
  action: 'index' | 'delete',
  status: IndexingStatus = 'pending',
  attemptCount: number = 0
  ): IndexingJob {
  return new IndexingJob(id, indexId, contentId, action, status, attemptCount);
  }

  /**
  * Reconstitute from persistence
  */
  static reconstitute(
  id: string,
  indexId: string,
  contentId: string,
  action: 'index' | 'delete',
  status: IndexingStatus,
  attemptCount: number = 0
  ): IndexingJob {
  return new IndexingJob(id, indexId, contentId, action, status, attemptCount);
  }

  private validateTransition(to: IndexingStatus): void {
  const validTransitions = IndexingJob.VALID_TRANSITIONS[this["status"]];
  if (!validTransitions.includes(to)) {
    throw new Error(
    `Invalid state transition: cannot transition from '${this["status"]}' to '${to}'. ` +
    `Valid transitions from '${this["status"]}' are: ${validTransitions.join(', ') || 'none'}`
    );
  }
  }

  /**
  * Start processing - returns new immutable instance
  * @returns New IndexingJob with 'processing' status and incremented attempt count
  */
  start(): IndexingJob {
  this.validateTransition('processing');
  return new IndexingJob(
    this["id"],
    this.indexId,
    this.contentId,
    this.action,
    'processing',
    this.attemptCount + 1
  );
  }

  /**
  * Mark as done - returns new immutable instance
  * @returns New IndexingJob with 'done' status
  */
  succeed(): IndexingJob {
  this.validateTransition('done');
  return new IndexingJob(
    this["id"],
    this.indexId,
    this.contentId,
    this.action,
    'done',
    this.attemptCount
  );
  }

  /**
  * Mark as failed - returns new immutable instance
  * @returns New IndexingJob with 'failed' status
  */
  fail(): IndexingJob {
  this.validateTransition('failed');
  return new IndexingJob(
    this["id"],
    this.indexId,
    this.contentId,
    this.action,
    'failed',
    this.attemptCount
  );
  }

  /**
  * Reset for retry - returns new immutable instance
  * @returns New IndexingJob with 'pending' status
  */
  retry(): IndexingJob {
  this.validateTransition('pending');
  return new IndexingJob(
    this["id"],
    this.indexId,
    this.contentId,
    this.action,
    'pending',
    this.attemptCount
  );
  }

  /**
  * Check if job can be retried
  */
  canRetry(): boolean {
  return this["status"] === 'failed';
  }

  /**
  * Check if job is in terminal state
  */
  isTerminal(): boolean {
  return this["status"] === 'done';
  }

  /**
  * Check if job is pending
  */
  isPending(): boolean {
  return this["status"] === 'pending';
  }

  /**
  * Check if job is processing
  */
  isProcessing(): boolean {
  return this["status"] === 'processing';
  }
}
