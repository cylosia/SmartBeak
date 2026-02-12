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
  * @param id - Unique experiment identifier
  * @param name - Human-readable experiment name
  * @param status - Current experiment status
  */
  constructor(
  readonly id: string,
  readonly name: string,
  readonly status: ExperimentStatus
  ) {}
}
