-- Rollback: Drop search_indexes, search_documents, and indexing_jobs tables
DROP TABLE IF EXISTS indexing_jobs CASCADE;
DROP TABLE IF EXISTS search_documents CASCADE;
DROP TABLE IF EXISTS search_indexes CASCADE;
