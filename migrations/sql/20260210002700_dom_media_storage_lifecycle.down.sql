-- Baseline migration — irreversible.
-- To undo changes from this migration, write a new forward migration.
DO $$ BEGIN RAISE EXCEPTION 'Baseline migration 20260210002700_dom_media_storage_lifecycle cannot be rolled back'; END $$;
