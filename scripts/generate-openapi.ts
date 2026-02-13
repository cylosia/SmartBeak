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

import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

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
