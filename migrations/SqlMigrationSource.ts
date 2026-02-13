import { readdirSync, readFileSync } from 'node:fs';
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
    const upPath = join(SQL_DIR, `${migration}.up.sql`);
    const downPath = join(SQL_DIR, `${migration}.down.sql`);
    const upSql = readFileSync(upPath, 'utf8');
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
