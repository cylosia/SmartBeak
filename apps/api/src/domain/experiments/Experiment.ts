import type { ExperimentId } from '@kernel/branded';

export type { ExperimentId };

/**
* Unified experiment status type — matches the Zod schema in experimentStartJob.ts
* P2-TYPE FIX: Previously the class had 3 statuses while the job schema had 5
*/
export type ExperimentStatus = 'draft' | 'ready' | 'running' | 'completed' | 'cancelled';

/**
* Experiment domain entity
* Represents an A/B test or experiment within the system
*/
export class Experiment {
  /**
  * Creates an Experiment instance
  * @param id - Unique experiment identifier (branded UUID — prevents mixing with other entity IDs)
  * @param name - Human-readable experiment name
  * @param status - Current experiment status
  */
  constructor(
  // P1-TYPE FIX: Use branded ExperimentId instead of plain `string`.
  // Plain string allowed any string (including UserId, ContentId, raw literals) to
  // be passed here without compile-time error, creating IDOR risks at call sites
  // that construct Experiment from DB rows without explicit UUID validation.
  readonly id: ExperimentId,
  readonly name: string,
  readonly status: ExperimentStatus
  ) {}
}
