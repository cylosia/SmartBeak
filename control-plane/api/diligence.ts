
import { FastifyInstance, FastifyRequest } from 'fastify';

export interface TokenParams {
  token: string;
}

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
  const { token } = req.params as TokenParams;
  const session = await appWithDb.db.diligence_sessions.findActiveByToken(token);
  if (!session) return reply.code(403).send({ error: 'Invalid or expired token' });

  const snapshot = await appWithDb.db.query(
    'select * from diligence_domain_snapshot where domain_id = $1',
    [session.domain_id]
  );

  return snapshot.rows[0];
  });

  app.get('/diligence/:token/provenance', async (req, reply) => {
  const { token } = req.params as TokenParams;
  const session = await appWithDb.db.diligence_sessions.findActiveByToken(token);
  if (!session) return reply.code(403).send({ error: 'Invalid or expired token' });

  const intents = await appWithDb.db.query(
    'select * from human_intents where domain_id = $1 order by requested_at asc',
    [session.domain_id]
  );

  const aiArtifacts = await appWithDb.db.query(
    'select * from ai_advisory_artifacts where domain_id = $1 and buyer_visible = true',
    [session.domain_id]
  );

  return {
    intents: intents.rows,
    ai_advisory_artifacts: aiArtifacts.rows
  };
  });

  // Affiliate replacement summary (buyer-safe)
  app.get('/diligence/:token/affiliate-replacements', async (req, reply) => {
  const { token } = req.params as TokenParams;
  const session = await appWithDb.db.diligence_sessions.findActiveByToken(token);
  if (!session) return reply.code(403).send({ error: 'Invalid or expired token' });

  const res = await appWithDb.db.query(
    'select * from buyer_affiliate_replacement_summary',
    []
  );
  return res.rows[0];
  });
}
