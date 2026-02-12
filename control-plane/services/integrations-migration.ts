/**
* Provider input for migration
*/
export interface ProviderInput {
  provider: string;
  encrypted_api_key: string;
}

/**
* Migration input
*/
export interface MigrateCentralizedProvidersInput {
  org_id: string;
  providers: ProviderInput[];
}

/**
* Migration result
*/
export interface MigrateCentralizedProvidersResult {
  migrated: number;
  skipped: number;
}

/**
 * Database interface for migration operations
 */
export interface MigrationDb {
  org_integrations: {
    findOne(criteria: { org_id: string; provider: string }): Promise<unknown | null>;
    insert(record: { org_id: string; provider: string; encrypted_api_key: string; status: string; last_verified_at: Date }): Promise<void>;
  };
}

/**
* Safely migrates existing centralized provider credentials into
* org_integrations (never domain_integrations).
* Idempotent by provider.
* @param db - Database instance
* @param input - Migration input
* @returns Promise resolving to migration result
*/
export async function migrateCentralizedProviders(
  db: MigrationDb,
  input: MigrateCentralizedProvidersInput
): Promise<MigrateCentralizedProvidersResult> {
  // Validate inputs
  if (!input.org_id || typeof input.org_id !== 'string') {
  throw new Error('org_id is required and must be a string');
  }
  if (!Array.isArray(input.providers)) {
  throw new Error('providers must be an array');
  }

  let migrated = 0;
  let skipped = 0;

  for (const p of input.providers) {
  // Validate provider entry
  if (!p.provider || typeof p.provider !== 'string') {
    throw new Error('Each provider must have a valid provider name');
  }
  if (!p.encrypted_api_key || typeof p.encrypted_api_key !== 'string') {
    throw new Error('Each provider must have a valid encrypted_api_key');
  }

  const existing = await db.org_integrations.findOne({
    org_id: input.org_id,
    provider: p.provider
  });
  if (!existing) {
    await db.org_integrations.insert({
    org_id: input.org_id,
    provider: p.provider,
    encrypted_api_key: p.encrypted_api_key,
    status: 'connected',
    last_verified_at: new Date()
    });
    migrated++;
  } else {
    skipped++;
  }
  }

  return { migrated, skipped };
}
