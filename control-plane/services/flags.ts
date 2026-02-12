
import { Pool } from 'pg';
import { z } from 'zod';

const FlagKeySchema = z.string()
  .min(1, 'Flag key is required')
  .max(100, 'Flag key must be 100 characters or less')
  .regex(/^[a-zA-Z0-9_-]+$/, 'Flag key must contain only alphanumeric characters, underscores, and hyphens');

const FlagValueSchema = z.boolean();

function validateFlagKey(key: unknown): string {
  const result = FlagKeySchema.safeParse(key);
  if (!result.success) {
  throw new Error(`Invalid flag key: ${result["error"].message}`);
  }
  return result.data;
}

function validateFlagValue(value: unknown): boolean {
  const result = FlagValueSchema.safeParse(value);
  if (!result.success) {
  throw new Error(`Invalid flag value: ${result["error"].message}`);
  }
  return result.data;
}

export class FlagService {
  constructor(private pool: Pool) {}

  async isEnabled(key: string): Promise<boolean> {
  const validatedKey = validateFlagKey(key);

  const { rows } = await this.pool.query(
    'SELECT value FROM system_flags WHERE key=$1',
    [validatedKey]
  );
  return rows[0]?.value ?? false;
  }

  async set(key: string, value: boolean): Promise<void> {
  const validatedKey = validateFlagKey(key);
  const validatedValue = validateFlagValue(value);

  await this.pool.query(
    `INSERT INTO system_flags (key, value)
    VALUES ($1,$2)
    ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=now()`,
    [validatedKey, validatedValue]
  );
  }
}
