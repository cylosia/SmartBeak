/**
 * Fencing Token Validation
 *
 * Validates fencing tokens from distributed locks before database writes.
 * Prevents stale lock holders from corrupting data after their lock has
 * expired and been re-acquired by another worker.
 */

import { PoolClient } from 'pg';
import { DatabaseError } from '@errors';

/**
 * Validate and store a fencing token before a write operation.
 *
 * Returns true if this fencing token is current (no newer token has written).
 * Returns false if a newer token has already been recorded, meaning this
 * caller's lock has expired and another worker has taken over.
 *
 * @param client - PoolClient with an open transaction (BEGIN already issued by caller)
 * @param resourceType - Type of resource being locked (e.g., 'publishing_job')
 * @param resourceId - ID of the specific resource
 * @param fencingToken - The fencing token from the distributed lock
 * @returns true if the token is valid (no newer write), false otherwise
 * @throws DatabaseError if the query itself fails
 */
export async function validateFencingToken(
  client: PoolClient,
  resourceType: string,
  resourceId: string,
  fencingToken: number
): Promise<boolean> {
  if (!resourceType || !resourceId) {
    throw new Error('resourceType and resourceId must be non-empty strings');
  }

  const { rowCount } = await client.query(
    `INSERT INTO fence_tokens (resource_type, resource_id, fence_token, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (resource_type, resource_id)
     DO UPDATE SET fence_token = $3, updated_at = NOW()
     WHERE fence_tokens.fence_token < $3`,
    [resourceType, resourceId, fencingToken]
  );

  // M11: rowCount === null means the query did not execute at the driver level.
  // Returning false would silently block a valid write; throw so the caller can
  // detect the failure and retry rather than silently abandoning its work.
  if (rowCount === null) {
    throw new DatabaseError('validateFencingToken: query returned null rowCount');
  }

  return rowCount > 0;
}
