-- Baseline migration — irreversible.
-- To undo changes from this migration, write a new forward migration.
DO $$ BEGIN RAISE EXCEPTION 'Baseline migration 20260210003300_dom_customers_table cannot be rolled back'; END $$;
