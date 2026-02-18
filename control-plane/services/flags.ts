
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

export class FlagService {
  constructor(private pool: Pool) {}

  async isEnabled(key: string): Promise<boolean> {
    const validatedKey = validateFlagKey(key);

    // P1-4 FIX: A hung DB would block the event loop indefinitely without this timeout.
    const queryPromise = this.pool.query(
      'SELECT value FROM system_flags WHERE key=$1',
      [validatedKey]
    );
    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('Flag query timeout after 5000ms')), 5000)
    );
    const { rows } = await Promise.race([queryPromise, timeoutPromise]);
    return rows[0]?.value ?? false;
  }

  async set(key: string, value: boolean): Promise<void> {
  const validatedKey = validateFlagKey(key);
  const validatedValue = validateFlagValue(value);

  // P2-13 FIX: Include updated_at in the INSERT so new records don't have
  // NULL updated_at when the table column lacks a DEFAULT.
  await this.pool.query(
    `INSERT INTO system_flags (key, value, updated_at)
    VALUES ($1, $2, now())
    ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`,
    [validatedKey, validatedValue]
  );
  }

  async getAll(): Promise<Array<{ key: string; value: boolean; updatedAt: Date | null }>> {
  const { rows } = await this.pool.query(
    'SELECT key, value, updated_at FROM system_flags ORDER BY key'
  );
  return rows.map((r: { key: string; value: boolean; updated_at: Date | null }) => ({
    key: r.key,
    value: r.value,
    updatedAt: r.updated_at,
  }));
  }
}
