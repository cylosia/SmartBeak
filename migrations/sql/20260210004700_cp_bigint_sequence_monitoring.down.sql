-- Baseline migration — irreversible.
-- To undo changes from this migration, write a new forward migration.
DO $$ BEGIN RAISE EXCEPTION 'Baseline migration 20260210004700_cp_bigint_sequence_monitoring cannot be rolled back'; END $$;
