import { getLogger } from '@kernel/logger';

/**
* Credential Rotation Service
* Manages credential rotation schedules for integrations
*/

const logger = getLogger('credential-rotation');

/**
* Database query result row
*/
export interface QueryResultRow {
  [key: string]: unknown;
}

/**
* Database query result
*/
export interface QueryResult<T = QueryResultRow> {
  rows: T[];
  rowCount: number | null;
}

/**
* Database client interface
*/
export interface CredentialRotationDb {
  query<T = QueryResultRow>(sql: string, params: unknown[]): Promise<QueryResult<T>>;
}

/**
* Integration credential needing rotation
*/
export interface CredentialRotationItem {
  id: string;
  provider: string;
  rotation_due_at: Date;
  [key: string]: unknown;
}

/**
* Credentials needing rotation result
*/
export interface CredentialsNeedingRotationResult {
  org: CredentialRotationItem[];
  domain: CredentialRotationItem[];
}

/**
* Validate database client
*/
function validateDb(db: unknown): db is CredentialRotationDb {
  return (
  db !== null &&
  typeof db === 'object' &&
  'query' in db &&
  typeof (db as CredentialRotationDb).query === 'function'
  );
}

/**
* Get credentials that need rotation
* @param db - Database client
* @returns Object containing org and domain credentials needing rotation
* @throws Error if database query fails or invalid db provided
*/
export async function getCredentialsNeedingRotation(
  db: CredentialRotationDb
): Promise<CredentialsNeedingRotationResult> {
  try {
  // Validate database client
  if (!validateDb(db)) {
    logger["error"]('Invalid database client provided', new Error('Database validation failed'));
    throw new Error('Invalid database client: query method not found');
  }

  const now = new Date();

  // Validate date
  if (!Number.isFinite(now.getTime())) {
    logger["error"]('Invalid current date', new Error('Date validation failed'));
    throw new Error('Invalid system date');
  }

  // Query org integrations
  let orgResult: QueryResult<CredentialRotationItem>;
  try {
    // P1-6 FIX: Select only needed columns instead of SELECT * to avoid
    // fetching encrypted credentials, access tokens, and secrets into memory.
    orgResult = await db.query<CredentialRotationItem>(
    `SELECT id, provider, rotation_due_at FROM org_integrations
    WHERE rotation_due_at IS NOT NULL
    AND rotation_due_at < $1`,
    [now]
    );
  } catch (orgError) {
    logger["error"](
    'Failed to query org integrations',
    orgError instanceof Error ? orgError : new Error(String(orgError))
    );
    throw new Error('Failed to query org integrations');
  }

  // Query domain integrations
  let domResult: QueryResult<CredentialRotationItem>;
  try {
    // P1-6 FIX: Select only needed columns instead of SELECT *
    domResult = await db.query<CredentialRotationItem>(
    `SELECT id, provider, rotation_due_at FROM domain_integrations
    WHERE rotation_due_at IS NOT NULL
    AND rotation_due_at < $1`,
    [now]
    );
  } catch (domError) {
    logger["error"](
    'Failed to query domain integrations',
    domError instanceof Error ? domError : new Error(String(domError))
    );
    throw new Error('Failed to query domain integrations');
  }

  const result: CredentialsNeedingRotationResult = {
    org: orgResult.rows || [],
    domain: domResult.rows || [],
  };

  logger.info('Credentials needing rotation retrieved', {
    orgCount: result.org.length,
    domainCount: result.domain.length,
  });

  return result;
  } catch (error) {
  logger["error"](
    'Failed to get credentials needing rotation',
    error instanceof Error ? error : new Error(String(error))
  );
  throw error;
  }
}
