-- SEC FIX (P0): Scope system_flags by org_id to prevent tenant privilege escalation.
--
-- Previously, system_flags had a single-column PK on (key) making all flags global.
-- Any org-level "owner" role could set flags that affected every tenant on the platform
-- (e.g. disabling billing enforcement, enabling debug modes for all orgs).
--
-- This migration makes flags per-tenant by adding org_id to the primary key.
-- Existing rows (if any) are assigned org_id = 'legacy' so they do not pollute
-- real tenant namespaces; operators should review and re-set them under the
-- correct org_id or delete them.

-- Step 1: Add org_id column with a temporary DEFAULT for existing rows
ALTER TABLE system_flags
  ADD COLUMN IF NOT EXISTS org_id TEXT NOT NULL DEFAULT 'legacy';

-- Step 2: Drop the old single-column primary key
ALTER TABLE system_flags
  DROP CONSTRAINT IF EXISTS system_flags_pkey;

-- Step 3: Establish the new composite primary key (org_id, key)
ALTER TABLE system_flags
  ADD CONSTRAINT system_flags_org_key_pkey PRIMARY KEY (org_id, key);

-- Step 4: Remove the temporary DEFAULT so future INSERTs must supply org_id
ALTER TABLE system_flags
  ALTER COLUMN org_id DROP DEFAULT;

-- Step 5: Index org_id alone for the GET /admin/flags (getAll by org) query
CREATE INDEX IF NOT EXISTS idx_system_flags_org_id
  ON system_flags (org_id);

-- Step 6: Add index on usage_alerts (org_id) WHERE triggered=false for
--         AlertService.getActiveAlerts(), which filters by org_id and triggered
--         but does NOT filter by metric (so the existing (org_id, metric) partial
--         index is not used by that query path).
CREATE INDEX IF NOT EXISTS idx_usage_alerts_org_active
  ON usage_alerts (org_id)
  WHERE triggered = false;

-- Step 7: Add updated_at to usage_alerts so check() can set it
ALTER TABLE usage_alerts
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
