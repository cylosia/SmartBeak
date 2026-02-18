/**
 * Generate OpenAPI spec from the running Fastify server.
 *
 * Usage: tsx scripts/generate-openapi.ts
 *
 * This starts the Fastify app (without listening), calls app.swagger()
 * to retrieve the auto-generated OpenAPI document, and writes it to
 * docs/openapi.json. Used by CI to verify spec freshness and run
 * breaking-change detection.
 */

import { randomBytes } from 'crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// P1-13 FIX: use fileURLToPath to correctly convert the ESM module URL to a
// filesystem path. import.meta.url.replace('file://', '') is incorrect on Windows
// (leaves '/C:/...' with a leading slash) and fails on paths with URL-encoded chars.
const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.example as fallback values for CI / spec generation.
// These are never used at runtime — they only satisfy the fail-fast
// config validations during module loading so the OpenAPI spec can
// be extracted from the route definitions.
const envExamplePath = resolve(__dirname, '..', '.env.example');
try {
  const envExample = readFileSync(envExamplePath, 'utf-8');
  for (const line of envExample.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    // P2-15 FIX: validate key is a safe env var name before injecting into process.env
    if (key && /^[A-Z_][A-Z0-9_]*$/i.test(key) && !process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env.example not found — continue without defaults
}

// Override secrets that have placeholder-detection validation with
// random values. These are never used — they only pass validation.
const rnd = () => randomBytes(32).toString('hex');
// P1-14 FIX: use test-format prefixes (sk_test_, pk_test_) not live-format prefixes.
// sk_live_ / pk_live_ prefixes trigger secret scanners (GitHub, GitGuardian) and can
// activate production-mode code-paths that gate on the key prefix.
const secretOverrides: Record<string, string> = {
  JWT_KEY_1: rnd(),
  JWT_KEY_2: rnd(),
  KEY_ENCRYPTION_SECRET: rnd(),
  CLERK_SECRET_KEY: `sk_test_${rnd()}`,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_test_${rnd()}`,
  CLERK_WEBHOOK_SECRET: `whsec_${rnd()}`,
  STRIPE_SECRET_KEY: `sk_test_${rnd()}`,
  STRIPE_WEBHOOK_SECRET: `whsec_${rnd()}`,
  GBP_TOKEN_ENCRYPTION_KEY: rnd(),
};
for (const [key, value] of Object.entries(secretOverrides)) {
  process.env[key] = value;
}

async function main(): Promise<void> {
  // Dynamic import so the server module sets up all routes and plugins
  const { app } = await import('../control-plane/api/http.js');

  // @fastify/swagger exposes the spec once routes are registered
  await app.ready();

  const spec = app.swagger();
  // P1-13 FIX (second occurrence): use __dirname instead of import.meta.url mangling
  const outPath = resolve(__dirname, '..', 'docs', 'openapi.json');
  const tmpPath = `${outPath}.tmp`;

  mkdirSync(dirname(outPath), { recursive: true });
  // P2-13 FIX: write to a temp file and rename atomically so a mid-write kill
  // (OOM, disk full) never leaves a partially-written / invalid openapi.json.
  writeFileSync(tmpPath, JSON.stringify(spec, null, 2) + '\n', 'utf-8');
  renameSync(tmpPath, outPath);

  process.stdout.write(`OpenAPI spec written to ${outPath}\n`);

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  // P2-14 FIX: include stack trace — `${err}` only gives "Error: message" which
  // makes CI failures extremely hard to debug.
  const detail = err instanceof Error ? err.stack : String(err);
  process.stderr.write(`Failed to generate OpenAPI spec: ${detail}\n`);
  process.exit(1);
});
