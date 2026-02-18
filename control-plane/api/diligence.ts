
import { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { rateLimit } from '../services/rate-limit';

export interface TokenParams {
  token: string;
}

// H02-FIX: Add Zod validation for token params (was using unsafe `as` cast)
const TokenParamSchema = z.object({
  token: z.string().min(10).max(100).regex(/^[a-zA-Z0-9_-]+$/)
});

// Extend FastifyInstance to include db
interface FastifyInstanceWithDb extends FastifyInstance {
  db: {
    diligence_sessions: {
      findActiveByToken: (token: string) => Promise<{ domain_id: string } | null>;
    };
    query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
  };
}

// D-1-FIX P1: Type guard replaces the unsafe `as FastifyInstanceWithDb` cast.
// Without a runtime check, a missing db plugin produces a TypeError deep inside a
// route handler rather than a clear startup error.
function hasDb(app: FastifyInstance): app is FastifyInstanceWithDb {
  return 'db' in app
    && app['db'] !== null
    && typeof app['db'] === 'object'
    && 'diligence_sessions' in (app['db'] as object)
    && 'query' in (app['db'] as object);
}

export async function registerDiligenceRoutes(app: FastifyInstance) {
  // D-1-FIX P1: Fail fast at registration time rather than at first request.
  if (!hasDb(app)) {
    throw new Error(
      'registerDiligenceRoutes: FastifyInstance is missing the db plugin. ' +
      'Ensure the db plugin is registered before calling registerDiligenceRoutes.'
    );
  }
  const appWithDb = app;

  app.get('/diligence/:token/overview', async (req, reply) => {
  // H02-FIX: Validate token via Zod instead of unsafe `as` cast
  const parseResult = TokenParamSchema.safeParse(req.params);
  if (!parseResult.success) return reply.code(400).send({ error: 'Invalid token format' });
  const { token } = parseResult.data;
  // D-4-FIX P2: Rate limit per IP to prevent token brute-force / quota exhaustion.
  try { rateLimit(req.ip ?? 'unknown', 30, 'diligence'); } catch { return reply.code(429).send({ error: 'Too many requests' }); }
  const session = await appWithDb.db.diligence_sessions.findActiveByToken(token);
  // D-6-FIX P2: Return 404 instead of 403 — a 403 leaks that the token is valid-format
  // but expired/revoked, revealing information about the token space to attackers.
  if (!session) return reply.code(404).send({ error: 'Not found' });

  // H03-FIX: Enumerate columns explicitly instead of SELECT *
  const snapshot = await appWithDb.db.query(
    'SELECT domain_id, domain_name, traffic_monthly, revenue_monthly, content_count, niche, age_years, created_at FROM diligence_domain_snapshot WHERE domain_id = $1',
    [session.domain_id]
  );

  // P2-13 FIX: Return 404 instead of 200-with-null for missing data
  if (!snapshot.rows[0]) return reply.code(404).send({ error: 'No snapshot data found' });
  return snapshot.rows[0];
  });

  app.get('/diligence/:token/provenance', async (req, reply) => {
  const parseResult = TokenParamSchema.safeParse(req.params);
  if (!parseResult.success) return reply.code(400).send({ error: 'Invalid token format' });
  const { token } = parseResult.data;
  // D-4-FIX P2 / D-6-FIX P2: Rate limit + 404 (see overview handler for rationale).
  try { rateLimit(req.ip ?? 'unknown', 30, 'diligence'); } catch { return reply.code(429).send({ error: 'Too many requests' }); }
  const session = await appWithDb.db.diligence_sessions.findActiveByToken(token);
  if (!session) return reply.code(404).send({ error: 'Not found' });

  // M02-FIX: Run queries in parallel instead of sequentially
  // P1-LIMIT-FIX: Added LIMIT 500 to both queries. Without it, a domain with thousands
  // of intent or artifact records returns all rows to the buyer — a potential OOM/DoS
  // vector. The parallel Promise.all amplifies the impact (two unbounded scans at once).
  const [intents, aiArtifacts] = await Promise.all([
    appWithDb.db.query(
      'SELECT id, domain_id, intent_type, requested_at, status FROM human_intents WHERE domain_id = $1 ORDER BY requested_at ASC LIMIT 500',
      [session.domain_id]
    ),
    appWithDb.db.query(
      'SELECT id, domain_id, artifact_type, created_at FROM ai_advisory_artifacts WHERE domain_id = $1 AND buyer_visible = true LIMIT 500',
      [session.domain_id]
    ),
  ]);

  return {
    intents: intents.rows,
    ai_advisory_artifacts: aiArtifacts.rows
  };
  });

  // Affiliate replacement summary (buyer-safe)
  app.get('/diligence/:token/affiliate-replacements', async (req, reply) => {
  const parseResult = TokenParamSchema.safeParse(req.params);
  if (!parseResult.success) return reply.code(400).send({ error: 'Invalid token format' });
  const { token } = parseResult.data;
  // D-4-FIX P2 / D-6-FIX P2: Rate limit + 404 (see overview handler for rationale).
  try { rateLimit(req.ip ?? 'unknown', 30, 'diligence'); } catch { return reply.code(429).send({ error: 'Too many requests' }); }
  const session = await appWithDb.db.diligence_sessions.findActiveByToken(token);
  if (!session) return reply.code(404).send({ error: 'Not found' });

  // C02-FIX: Add WHERE domain_id filter to prevent cross-tenant data leakage
  // P1-LIMIT-FIX: Added LIMIT 1. The caller returns only rows[0] but without
  // LIMIT the database fetches all matching rows into memory, enabling a DOS
  // if a domain accumulates large numbers of affiliate replacement records.
  const res = await appWithDb.db.query(
    'SELECT domain_id, provider_name, replacement_count, estimated_revenue FROM buyer_affiliate_replacement_summary WHERE domain_id = $1 LIMIT 1',
    [session.domain_id]
  );
  return res.rows[0] ?? null;
  });
}
