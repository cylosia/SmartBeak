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

  // F-5 FIX: JavaScript `number` is an IEEE 754 double with 53-bit integer mantissa.
  // Number.MAX_SAFE_INTEGER = 2^53 - 1 = 9_007_199_254_740_991.
  // Distributed lock fencing tokens (e.g. Redlock) are monotonically-incrementing
  // 64-bit integers; values above MAX_SAFE_INTEGER round silently to the nearest
  // representable float. The rounded value fed into the PostgreSQL `fence_token < $3`
  // comparison then produces wrong results — a stale lock holder passes as "current",
  // corrupting the resource it should have been blocked from writing.
  // Fail fast here rather than silently letting a corrupting write through.
  if (!Number.isInteger(fencingToken) || fencingToken < 0 || fencingToken > Number.MAX_SAFE_INTEGER) {
    throw new DatabaseError(
      `validateFencingToken: fencingToken must be a safe non-negative integer ` +
      `(received ${fencingToken}). For tokens that may exceed 2^53, migrate the ` +
      `parameter type to bigint and pass token.toString() to the query.`
    );
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
