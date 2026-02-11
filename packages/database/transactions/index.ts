import { PoolClient, QueryConfig } from 'pg';
import { getPool } from '../pool';
import { getLogger } from '@kernel/logger';
import { TransactionError } from '../errors';

export { TransactionError } from '../errors';

const logger = getLogger('database:transactions');

const VALID_ISOLATION_LEVELS = ['READ UNCOMMITTED', 'READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE'] as const;
export type IsolationLevel = typeof VALID_ISOLATION_LEVELS[number];

/**
 * Validate isolation level against whitelist
 */
function validateIsolationLevel(level: string): IsolationLevel {
  if (!VALID_ISOLATION_LEVELS.includes(level as IsolationLevel)) {
    throw new Error(`Invalid isolation level: ${level}. Must be one of: ${VALID_ISOLATION_LEVELS.join(', ')}`);
  }
  return level as IsolationLevel;
}

// Transaction options with timeout
export interface TransactionOptions {
  timeoutMs?: number | undefined;
  isolationLevel?: IsolationLevel | undefined;
}

const DEFAULT_TRANSACTION_TIMEOUT = 30000; // 30 seconds
const DEFAULT_ISOLATION_LEVEL: IsolationLevel = 'READ COMMITTED';

/**
 * Client state tracking to prevent double-release
 */
export interface TrackedClient extends PoolClient {
  _isReleased?: boolean | undefined;
  _releaseError?: boolean | undefined;
}

/**
 * Helper for transactions with timeout and proper cleanup
 */
export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>,
  options: TransactionOptions = {}
): Promise<T> {
  const { timeoutMs = DEFAULT_TRANSACTION_TIMEOUT, isolationLevel } = options;

  const pool = await getPool();
  const client = await pool.connect() as TrackedClient;
  let timeoutId: NodeJS.Timeout | undefined;
  let timeoutCleared = false;

  const releaseClient = (withError = false) => {
    if (client._isReleased) {
      logger.warn('Attempted to release already-released client');
      return;
    }
    client._isReleased = true;
    client._releaseError = withError;
    try {
      client.release(withError);
    } catch (releaseError) {
      logger["error"]('Error releasing client', releaseError as Error);
    }
  };

  const clearTimeoutSafe = () => {
    if (timeoutId && !timeoutCleared) {
      clearTimeout(timeoutId);
      timeoutCleared = true;
      timeoutId = undefined;
    }
  };

  try {
    await client.query('SET LOCAL statement_timeout = $1', [timeoutMs]);

    const validatedIsolation = isolationLevel 
      ? validateIsolationLevel(isolationLevel) 
      : DEFAULT_ISOLATION_LEVEL;
    await client.query(`BEGIN ISOLATION LEVEL ${validatedIsolation}`);

    const abortController = new AbortController();

    // P1-FIX: Link abortController to timeout cleanup
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        if (!abortController.signal.aborted) {
          abortController.abort();
          reject(new Error(`Transaction timeout after ${timeoutMs}ms`));
        }
      }, timeoutMs);
    });

    let result: T;
    try {
      result = await Promise.race([
        fn(client),
        timeoutPromise,
      ]);

      await client.query('COMMIT');
      return result;
    } finally {
      // P1-FIX: Always clear timeout and abort in finally block
      clearTimeoutSafe();
      abortController.abort();
    }
  } catch (error) {
    clearTimeoutSafe();

    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      // CRITICAL: Log rollback failure with full context
      const rollbackErr = rollbackError instanceof Error 
        ? rollbackError 
        : new Error(String(rollbackError));
      
      logger.error(
        'Rollback failed - transaction may be in inconsistent state',
        rollbackErr,
        {
          originalError: error instanceof Error ? error.message : String(error),
          originalErrorName: error instanceof Error ? error.name : 'Unknown',
        }
      );
      
      // Release client with error flag to prevent reuse
      releaseClient(true);
      
      // Throw TransactionError that chains both errors
      const originalErr = error instanceof Error 
        ? error 
        : new Error(String(error));
      
      throw new TransactionError(
        `Transaction failed and rollback also failed: ${originalErr.message}`,
        originalErr,
        rollbackErr
      );
    }
    throw error;
  } finally {
    clearTimeoutSafe();
    releaseClient(false);
  }
}
// Helper for single queries (auto-retry on connection errors)
// P1-FIX: Add explicit return type for type safety
export async function query(text: string, params?: unknown[], timeoutMs?: number): Promise<import('pg').QueryResult> {
  const pool = await getPool();
  const maxRetries = 3;
  let lastError: Error | undefined;

  const startTime = Date.now();
  const { getConnectionMetrics } = await import('../pool');
  const metrics = getConnectionMetrics();

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const queryConfig: { text: string; values?: unknown[] | undefined; timeout?: number | undefined } = {
        text: text,
        values: params,
      };

      if (timeoutMs) {
        queryConfig.timeout = timeoutMs;
      }

      const result = await pool.query(queryConfig as QueryConfig);

      const duration = Date.now() - startTime;
      if (duration > 1000) {
        logger.warn('Slow query detected', { duration, query: text.substring(0, 100) });
      }

      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (attempt < maxRetries && isConnectionError(lastError)) {
        logger.warn(`Connection error on attempt ${attempt}, retrying...`, { attempt });
        await sleep(100 * attempt);
        continue;
      }

      throw error;
    }
  }

  throw lastError;
}

function isConnectionError(error: Error): boolean {
  const message = error["message"].toLowerCase();
  return (
    message.includes('connection') ||
    message.includes('timeout') ||
    message.includes('econnrefused') ||
    message.includes('enotfound')
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Where condition interface
export interface WhereCondition {
  column: string;
  operator: '=' | '<' | '>' | '<=' | '>=' | '<>' | '!=';
  value: unknown;
}

function validateColumnName(columnName: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(columnName)) {
    throw new Error(`Invalid column name: ${columnName}. Must be valid SQL identifier.`);
  }
  return columnName;
}

function buildWhereClause(conditions: WhereCondition[]): { clause: string; params: unknown[] } {
  const params: unknown[] = [];
  const clauses: string[] = [];

  for (let i = 0; i < conditions.length; i++) {
    // P1-FIX: Remove non-null assertion, use bounds check
    const condition = conditions[i];
    if (!condition) continue;
    const validatedColumn = validateColumnName(condition.column);
    const allowedOperators = ['=', '<', '>', '<=', '>=', '<>', '!='];
    if (!allowedOperators.includes(condition.operator)) {
      throw new Error(`Invalid operator: ${condition.operator}`);
    }
    params.push(condition.value);
    clauses.push(`${validatedColumn} ${condition.operator} $${i + 1}`);
  }

  return {
    clause: clauses.join(' AND '),
    params,
  };
}

const ALLOWED_TABLES = [
  'users',
  'domains',
  'content',
  'content_items',
  'keyword_metrics',
  'content_performance',
  'content_ideas',
  'audit_events',
  'domain_settings',
  'domain_registry',
  'memberships',
  'content_roi_models',
  'domain_exports',
  'feedback_metrics',
] as const;

export type AllowedTable = typeof ALLOWED_TABLES[number];

function validateTableName(tableName: string): AllowedTable {
  if (!ALLOWED_TABLES.includes(tableName as AllowedTable)) {
    throw new Error(`Invalid table name: ${tableName}. Table not in allowed list.`);
  }
  return tableName as AllowedTable;
}

/**
 * Execute query with row locking
 * P1-FIX: Add proper generic constraints for type safety
 */
export async function withLock<T extends unknown, Row extends Record<string, unknown> = Record<string, unknown>>(
  tableName: string,
  whereConditions: WhereCondition[],
  fn: (client: PoolClient, rows: Row[]) => Promise<T>,
  options: { skipLocked?: boolean; wait?: boolean } = {}
): Promise<T> {
  const validatedTableName = validateTableName(tableName);

  if (!whereConditions || whereConditions.length === 0) {
    throw new Error('WHERE conditions are required for row locking');
  }

  const { clause: whereClause, params } = buildWhereClause(whereConditions);

  return withTransaction(async (client) => {
    let lockClause = 'FOR UPDATE';

    if (options.skipLocked) {
      lockClause += ' SKIP LOCKED';
    } else if (options.wait === false) {
      lockClause += ' NOWAIT';
    }

    const { rows } = await client.query(
      `SELECT * FROM "${validatedTableName}" WHERE ${whereClause} ${lockClause}`,
      params,
    );

    return fn(client, rows);
  });
}

/**
 * Batch insert helper
 * P0-FIX: Wrap in transaction for atomicity
 */
export async function batchInsert<T extends Record<string, unknown>>(
  tableName: string,
  records: T[],
  batchSize = 1000
): Promise<void> {
  if (records.length === 0) return;

  const validatedTableName = validateTableName(tableName);

  const columns = Object.keys(records[0]!) as (keyof T)[];
  for (const record of records) {
    const recordColumns = Object.keys(record);
    if (recordColumns.length !== columns.length ||
      !recordColumns.every(col => columns.includes(col))) {
      throw new Error('All records must have the same columns');
    }
  }

  const validatedColumns = columns.map(col => validateColumnName(col as string));

  // P0-FIX: Use transaction for atomic batch insert
  return withTransaction(async (trx) => {
    for (let i = 0; i < records.length; i += batchSize) {
      const batch = records.slice(i, i + batchSize);
      const values: unknown[] = [];
      const placeholders: string[] = [];

      let paramIndex = 1;
      for (const record of batch) {
        const rowPlaceholders: string[] = [];
        for (const col of columns) {
          values.push(record[col]);
          rowPlaceholders.push(`$${paramIndex++}`);
        }
        placeholders.push(`(${rowPlaceholders.join(',')})`);
      }

      const sql = `
        INSERT INTO "${validatedTableName}" (${validatedColumns.map(c => `"${c}"`).join(',')})
        VALUES ${placeholders.join(',')}
      `;

      await trx.query(sql, values);
    }
  });
}


