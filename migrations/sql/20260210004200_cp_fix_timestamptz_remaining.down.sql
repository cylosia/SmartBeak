-- Baseline migration — irreversible.
-- To undo changes from this migration, write a new forward migration.
DO $$ BEGIN RAISE EXCEPTION 'Baseline migration 20260210004200_cp_fix_timestamptz_remaining cannot be rolled back'; END $$;
