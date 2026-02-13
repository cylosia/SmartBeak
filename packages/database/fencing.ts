/**
 * Fencing Token Validation
 *
 * Validates fencing tokens from distributed locks before database writes.
 * Prevents stale lock holders from corrupting data after their lock has
 * expired and been re-acquired by another worker.
 */

import { PoolClient } from 'pg';

/**
 * Validate and store a fencing token before a write operation.
 *
 * Returns true if this fencing token is current (no newer token has written).
 * Returns false if a newer token has already been recorded, meaning this
 * caller's lock has expired and another worker has taken over.
 *
 * @param client - The PoolClient within a transaction
 * @param resourceType - Type of resource being locked (e.g., 'publishing_job')
 * @param resourceId - ID of the specific resource
 * @param fencingToken - The fencing token from the distributed lock
 * @returns true if the token is valid (no newer write), false otherwise
 */
export async function validateFencingToken(
  client: PoolClient,
  resourceType: string,
  resourceId: string,
  fencingToken: number
): Promise<boolean> {
  const { rowCount } = await client.query(
    `INSERT INTO fence_tokens (resource_type, resource_id, fence_token, updated_at)
     VALUES ($1, $2, $3, NOW())
     ON CONFLICT (resource_type, resource_id)
     DO UPDATE SET fence_token = $3, updated_at = NOW()
     WHERE fence_tokens.fence_token < $3`,
    [resourceType, resourceId, fencingToken]
  );
  return (rowCount ?? 0) > 0;
}
