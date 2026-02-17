
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
  listEnabled(domainId: string, limit?: number, client?: PoolClient): Promise<PublishTarget[]>;

  /**
  * Save or update a publish target
  *
  * @param target - The publish target to save
  * @param client - Optional database client for transaction context
  * @returns Promise resolving when save is complete
  * @throws {Error} If persistence operation fails
  */
  save(target: PublishTarget, client?: PoolClient): Promise<void>;

  /**
  * Get a publish target by ID
  *
  * @param id - The unique identifier of the publish target
  * @param client - Optional database client for transaction context
  * @returns Promise resolving to the target, or null if not found
  * @throws {Error} If query execution fails
  */
  getById(id: string, client?: PoolClient): Promise<PublishTarget | null>;

  /**
  * Delete a publish target
  *
  * @param id - The unique identifier of the target to delete
  * @param client - Optional database client for transaction context
  * @returns Promise resolving when deletion is complete
  * @throws {Error} If deletion fails
  */
  delete(id: string, client?: PoolClient): Promise<void>;
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
