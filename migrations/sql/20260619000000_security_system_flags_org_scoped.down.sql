-- Rollback: restore system_flags to global (single-column PK on key)

DROP INDEX IF EXISTS idx_usage_alerts_org_active;
DROP INDEX IF EXISTS idx_system_flags_org_id;

ALTER TABLE system_flags
  DROP CONSTRAINT IF EXISTS system_flags_org_key_pkey;

ALTER TABLE system_flags
  ADD CONSTRAINT system_flags_pkey PRIMARY KEY (key);

ALTER TABLE system_flags
  DROP COLUMN IF EXISTS org_id;

ALTER TABLE usage_alerts
  DROP COLUMN IF EXISTS updated_at;
