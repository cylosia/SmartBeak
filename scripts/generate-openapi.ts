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
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

// Load .env.example as fallback values for CI / spec generation.
// These are never used at runtime — they only satisfy the fail-fast
// config validations during module loading so the OpenAPI spec can
// be extracted from the route definitions.
const envExamplePath = resolve(dirname(import.meta.url.replace('file://', '')), '..', '.env.example');
try {
  const envExample = readFileSync(envExamplePath, 'utf-8');
  for (const line of envExample.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env.example not found — continue without defaults
}

// Override secrets that have placeholder-detection validation with
// random values. These are never used — they only pass validation.
const rnd = () => randomBytes(32).toString('hex');
const secretOverrides: Record<string, string> = {
  JWT_KEY_1: rnd(),
  JWT_KEY_2: rnd(),
  KEY_ENCRYPTION_SECRET: rnd(),
  CLERK_SECRET_KEY: `sk_live_${rnd()}`,
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: `pk_live_${rnd()}`,
  CLERK_WEBHOOK_SECRET: `whsec_${rnd()}`,
  STRIPE_SECRET_KEY: `sk_live_${rnd()}`,
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
  const outPath = resolve(dirname(import.meta.url.replace('file://', '')), '..', 'docs', 'openapi.json');

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(spec, null, 2) + '\n', 'utf-8');

  process.stdout.write(`OpenAPI spec written to ${outPath}\n`);

  await app.close();
  process.exit(0);
}

main().catch((err) => {
  process.stderr.write(`Failed to generate OpenAPI spec: ${err}\n`);
  process.exit(1);
});
