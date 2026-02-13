-- Baseline migration — irreversible.
-- To undo changes from this migration, write a new forward migration.
DO $$ BEGIN RAISE EXCEPTION 'Baseline migration 20260210004500_cp_partial_indexes_soft_delete cannot be rolled back'; END $$;
