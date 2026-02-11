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
  readonly status: 'draft' | 'running' | 'completed'
  ) {}
}
