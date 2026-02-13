-- Baseline migration — irreversible.
-- To undo changes from this migration, write a new forward migration.
DO $$ BEGIN RAISE EXCEPTION 'Baseline migration 20260611000000_pkg_api_keys_provider_metadata cannot be rolled back'; END $$;
