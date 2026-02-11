
import { PoolClient } from 'pg';

import { PublishTarget } from '../../domain/entities/PublishTarget';

/**
* Repository interface for PublishTarget persistence.
*
* This interface manages publishing targets/destinations where content
* can be published (webhooks, APIs, CDNs, etc.).
*
* @throws {RepositoryError} Implementations should throw domain-appropriate errors
*/
export interface PublishTargetRepository {
  /**
  * List all enabled publish targets for a domain
  *
  * @param domainId - The domain/tenant identifier
  * @returns Promise resolving to array of enabled publish targets
  * @throws {Error} If query execution fails
  */
  listEnabled(domainId: string): Promise<PublishTarget[]>;

  /**
  * Save or update a publish target
  * MEDIUM FIX M13: Added save method to interface
  *
  * @param target - The publish target to save
  * @returns Promise resolving when save is complete
  * @throws {Error} If persistence operation fails
  */
  save(target: PublishTarget): Promise<void>;

  /**
  * Get a publish target by ID
  * MEDIUM FIX M14: Added getById method
  *
  * @param id - The unique identifier of the publish target
  * @returns Promise resolving to the target, or null if not found
  * @throws {Error} If query execution fails
  */
  getById(id: string): Promise<PublishTarget | null>;

  /**
  * Delete a publish target
  * MEDIUM FIX M15: Added delete method
  *
  * @param id - The unique identifier of the target to delete
  * @returns Promise resolving when deletion is complete
  * @throws {Error} If deletion fails
  */
  delete(id: string): Promise<void>;
}

/**
* Custom error class for repository operations
*/
export class PublishTargetError extends Error {
  constructor(
  message: string,
  public readonly code: string,
  override readonly cause?: unknown
  ) {
  super(message);
  this["name"] = 'PublishTargetError';
  }
}
