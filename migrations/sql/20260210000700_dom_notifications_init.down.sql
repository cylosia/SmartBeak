-- Baseline migration — irreversible.
-- To undo changes from this migration, write a new forward migration.
DO $$ BEGIN RAISE EXCEPTION 'Baseline migration 20260210000700_dom_notifications_init cannot be rolled back'; END $$;
