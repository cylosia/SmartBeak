
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
  throw new ValidationError(`Invalid flag key: ${result["error"].message}`);
  }
  return result.data;
}

function validateFlagValue(value: unknown): boolean {
  const result = FlagValueSchema.safeParse(value);
  if (!result.success) {
  throw new ValidationError(`Invalid flag value: ${result["error"].message}`);
  }
  return result.data;
}

export class FlagService {
  constructor(private pool: Pool) {}

  // SEC FIX (P0): All methods now require orgId so that flags are scoped per-tenant.
  // Previously system_flags had a global single-column PK on (key), allowing any
  // org-level 'owner' to set flags that took effect platform-wide (e.g. disabling
  // billing enforcement or toggling debug modes for every organization).

  async isEnabled(key: string, orgId: string): Promise<boolean> {
  const validatedKey = validateFlagKey(key);

  const { rows } = await this.pool.query(
    'SELECT value FROM system_flags WHERE key=$1 AND org_id=$2',
    [validatedKey, orgId]
  );
  return rows[0]?.value ?? false;
  }

  async set(key: string, value: boolean, orgId: string): Promise<void> {
  const validatedKey = validateFlagKey(key);
  const validatedValue = validateFlagValue(value);

  await this.pool.query(
    `INSERT INTO system_flags (key, value, org_id, updated_at)
    VALUES ($1, $2, $3, now())
    ON CONFLICT (org_id, key) DO UPDATE SET value=$2, updated_at=now()`,
    [validatedKey, validatedValue, orgId]
  );
  }

  async getAll(orgId: string): Promise<Array<{ key: string; value: boolean; updatedAt: Date | null }>> {
  const { rows } = await this.pool.query(
    'SELECT key, value, updated_at FROM system_flags WHERE org_id=$1 ORDER BY key',
    [orgId]
  );
  return rows.map((r: { key: string; value: boolean; updated_at: Date | null }) => ({
    key: r.key,
    value: r.value,
    updatedAt: r.updated_at,
  }));
  }
}
