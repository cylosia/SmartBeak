# P1-High Database Fixes - Implementation Tracker

This document tracks all P1-High database fixes being applied.

## Issues Being Fixed

### SQL Migrations
1. **P1-001:** Add index on content_genesis.ai_advisory_artifact_id
2. **P1-005:** Add index on domain_sale_readiness.domain_id
3. **P1-011:** Fix content_archive_tables migration (wrap in transaction + IF NOT EXISTS)
4. **P1-002:** Add RLS policies for multi-tenant tables
5. **P1-004:** Add idempotency to seed file
6. **Fix:** Fix TIMESTAMP without timezone in content_archive_tables

### TypeScript Files
1. **P1-003:** PostgresContentRevisionRepository - Add client parameter support
2. **P1-006:** apps/api/src/db.ts - Add replica lag validation
3. **P1-007:** apps/web/lib/db.ts - Add connection validation and lock_timeout
4. **P1-008:** SearchIndexingWorker - Add batch processing with transaction context
5. **P1-009:** apps/api/src/db.ts - Fix silent analytics fallback
6. **P1-010:** apps/web/lib/db.ts - Add query plan capture for slow queries

## Output: Modified Files

### SQL Files Modified/Created:
- packages/db/migrations/20260228_add_content_genesis_indexes.sql (NEW)
- packages/db/migrations/20260228_add_domain_sale_readiness_index.sql (NEW)
- packages/db/migrations/20260228_fix_content_archive_transaction.sql (NEW)
- packages/db/migrations/20260228_add_rls_policies.sql (NEW)
- packages/db/migrations/20260228_fix_content_archive_timestamps.sql (NEW)
- packages/db/seeds/20260210_backfill_human_intents.sql (MODIFIED)

### TypeScript Files Modified:
- domains/content/infra/persistence/PostgresContentRevisionRepository.ts
- domains/content/application/ports/ContentRevisionRepository.ts
- domains/search/application/SearchIndexingWorker.ts
- apps/api/src/db.ts
- apps/web/lib/db.ts
