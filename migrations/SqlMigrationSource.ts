import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Knex } from 'knex';

const SQL_DIR = join(import.meta.dirname, 'sql');

/**
 * Custom Knex MigrationSource that reads raw .sql files from migrations/sql/.
 *
 * Each migration is a pair of files:
 *   - <name>.up.sql   — forward migration
 *   - <name>.down.sql — rollback migration
 *
 * Knex wraps each migration in a transaction automatically.
 * If a .up.sql file contains CREATE INDEX CONCURRENTLY, the transaction
 * is disabled for that migration (PostgreSQL requirement).
 */
export class SqlMigrationSource implements Knex.MigrationSource<string> {
  getMigrations(): Promise<string[]> {
    const files = readdirSync(SQL_DIR)
      .filter(f => f.endsWith('.up.sql'))
      .map(f => f.replace('.up.sql', ''))
      .sort();
    return Promise.resolve(files);
  }

  getMigrationName(migration: string): string {
    return migration;
  }

  getMigration(migration: string): Knex.Migration {
    // Defense-in-depth: reject names with path-traversal sequences. In normal
    // operation getMigration() is called by Knex with values produced by
    // getMigrations() (which reads the real directory), so this only fires if
    // someone calls getMigration() directly with crafted input.
    if (!/^[a-zA-Z0-9_-]+$/.test(migration)) {
      throw new Error(
        `Invalid migration name: "${migration}". ` +
        `Migration names must contain only alphanumeric characters, underscores, and hyphens.`
      );
    }

    const upPath = join(SQL_DIR, `${migration}.up.sql`);
    const downPath = join(SQL_DIR, `${migration}.down.sql`);

    // Eagerly validate that the forward migration file exists with a clear message.
    // readFileSync throws a cryptic ENOENT; an explicit check mirrors the downPath
    // check below and makes CI failures easier to diagnose.
    if (!existsSync(upPath)) {
      throw new Error(
        `Migration file missing: ${upPath}. ` +
        `Every migration must have a corresponding .up.sql file.`
      );
    }

    const upSql = readFileSync(upPath, 'utf8');

    // P2-FIX: Eagerly validate that the rollback file exists when the migration
    // object is constructed (at migrate-plan time), not lazily when `down()` is
    // called. Without this check, a migration can be applied successfully but then
    // fail at rollback time — leaving the database in a partially-rolled-back state
    // that is difficult to recover from. Fail fast here to catch missing .down.sql
    // files before any schema changes are made.
    if (!existsSync(downPath)) {
      throw new Error(
        `Migration rollback file missing: ${downPath}. ` +
        `Every migration must have a corresponding .down.sql file.`
      );
    }

    const needsNoTransaction = /CONCURRENTLY/i.test(upSql);

    const migrationObj: Knex.Migration = {
      up: async (knex: Knex) => {
        await knex.raw(upSql);
      },
      down: async (knex: Knex) => {
        const downSql = readFileSync(downPath, 'utf8');
        await knex.raw(downSql);
      },
    };

    if (needsNoTransaction) {
      migrationObj.config = { transaction: false };
    }

    return migrationObj;
  }
}
