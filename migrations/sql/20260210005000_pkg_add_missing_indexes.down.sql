-- Baseline migration — irreversible.
-- To undo changes from this migration, write a new forward migration.
DO $$ BEGIN RAISE EXCEPTION 'Baseline migration 20260210005000_pkg_add_missing_indexes cannot be rolled back'; END $$;
