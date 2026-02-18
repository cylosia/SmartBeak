import knex, { type Knex } from 'knex';
import { resolve, join } from 'node:path';
import { writeFileSync, mkdirSync } from 'node:fs';
import { SqlMigrationSource } from '../migrations/SqlMigrationSource.js';

const ROOT = resolve(import.meta.dirname, '..');
const SQL_DIR = join(ROOT, 'migrations', 'sql');

/**
 * SmartBeak Database Migration CLI
 *
 * Commands:
 *   up | latest       Run all pending migrations
 *   down | rollback    Rollback last batch (--all for everything)
 *   status             Show applied vs pending migrations
 *   make <name>        Create a new migration (up + down SQL files)
 *   baseline           Mark all existing migrations as applied (batch 0)
 */

/**
 * P3-12 FIX: Sanitize a connection string for safe inclusion in log/error messages.
 * Replaces the userinfo (user:password@) portion of the URL with `***:***@`.
 */
function sanitizeConnectionString(connStr: string): string {
  try {
    const url = new URL(connStr);
    if (url.username || url.password) {
      url.username = '***';
      url.password = '***';
    }
    return url.toString();
  } catch {
    // Not a valid URL — redact everything after "://" up to the first "@"
    return connStr.replace(/:\/\/[^@]*@/, '://***:***@');
  }
}

function createKnexInstance(): Knex {
  const connectionString = process.env['CONTROL_PLANE_DB'];
  if (!connectionString) {
    console.error('Error: CONTROL_PLANE_DB environment variable is required.');
    console.error('Set it to your PostgreSQL connection string.');
    process.exit(1);
  }

  const isProduction = process.env['NODE_ENV'] === 'production';

  // P3-11 FIX: Warn if connecting to a production database without SSL.
  // This guards against accidentally running migrations over an unencrypted
  // connection where credentials and data could be intercepted.
  if (isProduction) {
    const hasSSLParam = connectionString.includes('sslmode=') || connectionString.includes('ssl=');
    if (!hasSSLParam) {
      console.warn(
        'WARNING: Connecting to a production database. SSL is enforced via config, ' +
        'but the connection string does not contain an explicit sslmode parameter. ' +
        `Connection: ${sanitizeConnectionString(connectionString)}`
      );
    }
  }

  return knex({
    client: 'postgresql',
    connection: {
      connectionString,
      ...(isProduction
        ? { ssl: { rejectUnauthorized: process.env['DB_SSL_REJECT_UNAUTHORIZED'] !== 'false' } }
        : {}),
    },
    pool: { min: 1, max: 5 },
    migrations: {
      tableName: 'schema_migrations',
      migrationSource: new SqlMigrationSource(),
    },
  });
}

const command = process.argv[2];

// Commands that don't need a database connection
const offlineCommands = new Set(['make', undefined]);

async function runUp(db: Knex) {
  console.log('Running all pending migrations...');
  const [batch, log] = await db.migrate.latest();
  if (log.length === 0) {
    console.log('Already up to date.');
  } else {
    console.log(`Batch ${batch}: ${log.length} migration(s) applied:`);
    for (const name of log) {
      console.log(`  + ${name}`);
    }
  }
}

async function runRollback(db: Knex) {
  const all = process.argv.includes('--all');
  console.log(all ? 'Rolling back all migrations...' : 'Rolling back last batch...');
  const [batch, log] = await db.migrate.rollback(undefined, all);
  if (log.length === 0) {
    console.log('Nothing to rollback.');
  } else {
    console.log(`Batch ${batch}: ${log.length} migration(s) rolled back:`);
    for (const name of log) {
      console.log(`  - ${name}`);
    }
  }
}

async function runStatus(db: Knex) {
  const [completed, pending] = await db.migrate.list();
  console.log(`\nCompleted migrations (${completed.length}):`);
  for (const name of completed) {
    console.log(`  [x] ${name}`);
  }
  console.log(`\nPending migrations (${pending.length}):`);
  for (const item of pending) {
    const name = typeof item === 'string' ? item : item.name ?? item.file ?? String(item);
    console.log(`  [ ] ${name}`);
  }
  console.log('');
}

function runMake() {
  const name = process.argv[3];
  if (!name) {
    console.error('Usage: npm run migrate:make -- <name>');
    console.error('Example: npm run migrate:make -- add_tags_table');
    process.exit(1);
  }

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, '')
    .slice(0, 14);
  const safeName = name.replace(/[^a-z0-9_]/gi, '_').toLowerCase();
  const baseName = `${timestamp}_${safeName}`;

  mkdirSync(SQL_DIR, { recursive: true });

  const upFile = join(SQL_DIR, `${baseName}.up.sql`);
  const downFile = join(SQL_DIR, `${baseName}.down.sql`);
  const createdAt = new Date().toISOString();

  writeFileSync(
    upFile,
    `-- Migration: ${name}\n-- Created: ${createdAt}\n\n-- Add your migration SQL here\n`
  );
  writeFileSync(
    downFile,
    `-- Rollback: ${name}\n-- Created: ${createdAt}\n\n-- Add your rollback SQL here\n`
  );

  console.log('Created migration files:');
  console.log(`  UP:   ${upFile}`);
  console.log(`  DOWN: ${downFile}`);
}

async function runBaseline(db: Knex) {
  console.log('Baselining: marking all existing migrations as applied...');
  const source = new SqlMigrationSource();
  const migrations = await source.getMigrations();

  // Create the schema_migrations table if it doesn't exist
  const hasTable = await db.schema.hasTable('schema_migrations');
  if (!hasTable) {
    await db.schema.createTable('schema_migrations', (table) => {
      table.increments('id').primary();
      table.string('name').notNullable();
      table.integer('batch').notNullable();
      table.timestamp('migration_time').defaultTo(db.fn.now());
    });
  }

  // Create the lock table that Knex expects
  const hasLockTable = await db.schema.hasTable('schema_migrations_lock');
  if (!hasLockTable) {
    await db.schema.createTable('schema_migrations_lock', (table) => {
      table.increments('index').primary();
      table.integer('is_locked');
    });
    await db('schema_migrations_lock').insert({ is_locked: 0 });
  }

  // P1-8 FIX: Wrap all inserts in a transaction for atomicity.
  // If any insert fails, all are rolled back to avoid a partially-baselined state.
  const count = await db.transaction(async (trx) => {
    // Check which migrations are already recorded
    const existing = await trx('schema_migrations').select('name');
    const existingNames = new Set(existing.map((r: { name: string }) => r.name));

    let inserted = 0;
    for (const migration of migrations) {
      if (!existingNames.has(migration)) {
        await trx('schema_migrations').insert({
          name: migration,
          batch: 0,
          migration_time: new Date(),
        });
        inserted++;
      }
    }
    return inserted;
  });

  console.log(`Baselined ${count} migration(s) (batch 0).`);
  console.log(`Total tracked: ${migrations.length}`);
}

function printHelp() {
  console.log(`
SmartBeak Database Migration Tool

Usage: tsx scripts/migrate.ts <command>

Commands:
  up, latest       Run all pending migrations
  down, rollback   Rollback the last batch (--all for everything)
  status           Show migration status (applied / pending)
  make <name>      Create a new migration (paired .up.sql + .down.sql)
  baseline         Mark all existing migrations as applied without running them

Examples:
  npm run migrate                         # Apply pending migrations
  npm run migrate:rollback                # Rollback last batch
  npm run migrate:rollback -- --all       # Rollback everything
  npm run migrate:status                  # Show status
  npm run migrate:make -- add_tags_table  # Create new migration
  npm run migrate:baseline                # Baseline existing DB
`);
}

async function main() {
  // Only create DB connection for commands that need it
  const needsDb = !offlineCommands.has(command);
  let db: Knex | null = null;

  try {
    if (needsDb) {
      db = createKnexInstance();
    }

    switch (command) {
      case 'up':
      case 'latest':
        await runUp(db!);
        break;
      case 'down':
      case 'rollback':
        await runRollback(db!);
        break;
      case 'status':
        await runStatus(db!);
        break;
      case 'make':
        runMake();
        break;
      case 'baseline':
        await runBaseline(db!);
        break;
      default:
        printHelp();
        if (command) process.exit(1);
        break;
    }
  } catch (error) {
    // P3-12 FIX: Sanitize error messages to avoid leaking database credentials
    const rawMessage = error instanceof Error ? error.message : String(error);
    const safeMessage = sanitizeConnectionString(rawMessage);
    console.error('Migration failed:', safeMessage);
    process.exit(1);
  } finally {
    if (db) {
      await db.destroy();
    }
  }
}

// P2-33 FIX: Await the main() promise so that unhandled rejections are
// surfaced and the process exits with the correct code.
main().catch((error: unknown) => {
  const rawMessage = error instanceof Error ? error.message : String(error);
  console.error('Unhandled migration error:', sanitizeConnectionString(rawMessage));
  process.exit(1);
});
