-- Baseline migration — irreversible.
-- To undo changes from this migration, write a new forward migration.
DO $$ BEGIN RAISE EXCEPTION 'Baseline migration 20260210003700_cp_domain_settings cannot be rolled back'; END $$;
