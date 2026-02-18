
import { Pool } from 'pg';
import { z } from 'zod';

import { ValidationError } from '@errors';

const FlagKeySchema = z.string()
  .min(1, 'Flag key is required')
  .max(100, 'Flag key must be 100 characters or less')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Flag key must contain only alphanumeric characters, underscores, and hyphens');

const FlagValueSchema = z.boolean();

function validateFlagKey(key: unknown): string {
  const result = FlagKeySchema.safeParse(key);
  if (!result.success) {
    // M10 FIX: Don't expose Zod's internal error message structure to callers.
    throw new ValidationError('Invalid flag key: must be 1-100 alphanumeric/underscore/hyphen characters');
  }
  return result.data;
}

function validateFlagValue(value: unknown): boolean {
  const result = FlagValueSchema.safeParse(value);
  if (!result.success) {
    throw new ValidationError('Invalid flag value: must be a boolean');
  }
  return result.data;
}

/**
 * Race a DB query against a timeout, clearing the timer when the query wins.
 *
 * P1 FIX: The previous pattern created a bare `new Promise(...setTimeout(...))` and
 * passed it directly to Promise.race(). When the query resolved first the setTimeout
 * callback remained scheduled for up to 5 seconds. Under load (e.g. isEnabled() called
 * per-request at 1 000 rps) this produced 5 000 concurrent dangling timers, causing:
 *   - Timer pressure increasing GC pause times
 *   - Node.js refusing to exit cleanly on SIGTERM (open handles)
 *   - In extreme cases, ~5 000 extra reject() calls per second on settled promises
 *
 * Fix: store the timer ID and call clearTimeout() in a finally block so the timer is
 * always cancelled regardless of whether the query or the timeout wins.
 */
async function withQueryTimeout<T>(
  queryPromise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`${label} query timeout after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  try {
    return await Promise.race([queryPromise, timeoutPromise]);
  } finally {
    // Always clear the timer, whether the query won or the timeout fired.
    clearTimeout(timeoutId);
  }
}

const FLAG_QUERY_TIMEOUT_MS = 5000;

export class FlagService {
  constructor(private pool: Pool) {}

  async isEnabled(key: string): Promise<boolean> {
    const validatedKey = validateFlagKey(key);

    const { rows } = await withQueryTimeout(
      this.pool.query(
        'SELECT value FROM system_flags WHERE key=$1',
        [validatedKey]
      ),
      FLAG_QUERY_TIMEOUT_MS,
      'Flag isEnabled()'
    );
    return rows[0]?.value ?? false;
  }

  async set(key: string, value: boolean): Promise<void> {
    const validatedKey = validateFlagKey(key);
    const validatedValue = validateFlagValue(value);

    // P2-13 FIX: Include updated_at in the INSERT so new records don't have
    // NULL updated_at when the table column lacks a DEFAULT.
    await withQueryTimeout(
      this.pool.query(
        `INSERT INTO system_flags (key, value, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`,
        [validatedKey, validatedValue]
      ),
      FLAG_QUERY_TIMEOUT_MS,
      'Flag set()'
    );
  }

  async getAll(): Promise<Array<{ key: string; value: boolean; updatedAt: Date | null }>> {
    // F-3 FIX: Add timeout matching isEnabled() so a hung DB during flag enumeration
    // doesn't hold a pool connection indefinitely. The admin UI calls getAll() on
    // every page load; without a timeout, a single slow query could cascade into
    // pool exhaustion across the entire service.
    const { rows } = await withQueryTimeout(
      this.pool.query(
        'SELECT key, value, updated_at FROM system_flags ORDER BY key'
      ),
      FLAG_QUERY_TIMEOUT_MS,
      'Flag getAll()'
    );
    return rows.map((r: { key: string; value: boolean; updated_at: Date | null }) => ({
      key: r['key'],
      value: r['value'],
      updatedAt: r['updated_at'],
    }));
  }
}
