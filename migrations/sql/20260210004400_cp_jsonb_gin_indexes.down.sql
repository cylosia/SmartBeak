-- Baseline migration — irreversible.
-- To undo changes from this migration, write a new forward migration.
DO $$ BEGIN RAISE EXCEPTION 'Baseline migration 20260210004400_cp_jsonb_gin_indexes cannot be rolled back'; END $$;
