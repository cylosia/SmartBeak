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
 * @param fencingToken - The fencing token from the distributed lock.
 *   Accepts `bigint` (preferred) or `number` (for backwards compatibility with callers
 *   that haven't migrated yet). `bigint` avoids the IEEE 754 precision loss that
 *   silently corrupts tokens above Number.MAX_SAFE_INTEGER (2^53 - 1).
 * @returns true if the token is valid (no newer write), false otherwise
 * @throws DatabaseError if the token is invalid or the query fails
 *
 * P1 FIX: Changed parameter type from `number` to `bigint | number`.
 *
 * Rationale: Distributed lock libraries (Redlock, etc.) issue monotonically
 * incrementing 64-bit integer fencing tokens. JavaScript `number` is an IEEE 754
 * double with a 53-bit mantissa (Number.MAX_SAFE_INTEGER = 9_007_199_254_740_991).
 * Values above this threshold round silently to the nearest representable float.
 *
 * The previous signature `fencingToken: number` forced callers to downcast their
 * `bigint` to `number` BEFORE calling this function — the exact unsafe operation
 * we want to avoid. Accepting `bigint` directly lets the function do the conversion
 * safely (via `fencingToken.toString()`) and allows TypeScript to enforce bigint
 * arithmetic on callers who opt in.
 *
 * Existing `number` callers are still supported but receive the same MAX_SAFE_INTEGER
 * guard as before, providing a safe migration path.
 */
export async function validateFencingToken(
  client: PoolClient,
  resourceType: string,
  resourceId: string,
  fencingToken: bigint | number
): Promise<boolean> {
  if (!resourceType || !resourceId) {
    throw new Error('resourceType and resourceId must be non-empty strings');
  }

  // Convert to a canonical string representation for the PostgreSQL query.
  // Using string avoids any floating-point precision issues with large integers.
  let tokenString: string;
  if (typeof fencingToken === 'bigint') {
    if (fencingToken < 0n) {
      throw new DatabaseError(
        `validateFencingToken: fencingToken must be non-negative (received ${fencingToken})`
      );
    }
    tokenString = fencingToken.toString();
  } else {
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
        `(received ${fencingToken}). For tokens that may exceed 2^53, pass a bigint ` +
        `instead of a number to avoid IEEE 754 precision loss.`
      );
    }
    tokenString = String(fencingToken);
  }

  const { rowCount } = await client.query(
    `INSERT INTO fence_tokens (resource_type, resource_id, fence_token, updated_at)
     VALUES ($1, $2, $3::bigint, NOW())
     ON CONFLICT (resource_type, resource_id)
     DO UPDATE SET fence_token = $3::bigint, updated_at = NOW()
     WHERE fence_tokens.fence_token < $3::bigint`,
    [resourceType, resourceId, tokenString]
  );

  // M11: rowCount === null means the query did not execute at the driver level.
  // Returning false would silently block a valid write; throw so the caller can
  // detect the failure and retry rather than silently abandoning its work.
  if (rowCount === null) {
    throw new DatabaseError('validateFencingToken: query returned null rowCount');
  }

  return rowCount > 0;
}
