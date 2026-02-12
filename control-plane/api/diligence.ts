
import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

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

export async function registerDiligenceRoutes(app: FastifyInstance) {
  const appWithDb = app as FastifyInstanceWithDb;

  app.get('/diligence/:token/overview', async (req, reply) => {
  // H02-FIX: Validate token via Zod instead of unsafe `as` cast
  const parseResult = TokenParamSchema.safeParse(req.params);
  if (!parseResult.success) return reply.code(400).send({ error: 'Invalid token format' });
  const { token } = parseResult.data;
  const session = await appWithDb.db.diligence_sessions.findActiveByToken(token);
  if (!session) return reply.code(403).send({ error: 'Invalid or expired token' });

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
  const session = await appWithDb.db.diligence_sessions.findActiveByToken(token);
  if (!session) return reply.code(403).send({ error: 'Invalid or expired token' });

  // M02-FIX: Run queries in parallel instead of sequentially
  const [intents, aiArtifacts] = await Promise.all([
    appWithDb.db.query(
      'SELECT id, domain_id, intent_type, requested_at, status FROM human_intents WHERE domain_id = $1 ORDER BY requested_at ASC',
      [session.domain_id]
    ),
    appWithDb.db.query(
      'SELECT id, domain_id, artifact_type, created_at FROM ai_advisory_artifacts WHERE domain_id = $1 AND buyer_visible = true',
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
  const session = await appWithDb.db.diligence_sessions.findActiveByToken(token);
  if (!session) return reply.code(403).send({ error: 'Invalid or expired token' });

  // C02-FIX: Add WHERE domain_id filter to prevent cross-tenant data leakage
  // Previously returned ALL orgs' affiliate data without filtering
  const res = await appWithDb.db.query(
    'SELECT domain_id, provider_name, replacement_count, estimated_revenue FROM buyer_affiliate_replacement_summary WHERE domain_id = $1',
    [session.domain_id]
  );
  return res.rows[0] ?? null;
  });
}
