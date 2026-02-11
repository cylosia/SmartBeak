
import { FastifyInstance } from 'fastify';

export interface DomainParams {
  domainId: string;
}

// Extend FastifyInstance to include db
interface FastifyInstanceWithDb extends FastifyInstance {
  db: {
    query: (sql: string, params: unknown[]) => Promise<{ rows: unknown[] }>;
  };
}

export async function registerTimelineRoutes(app: FastifyInstance) {
  const appWithDb = app as FastifyInstanceWithDb;
  
  app.get('/timeline/domain/:domainId', async (req) => {
  const { domainId } = req.params as DomainParams;
  const res = await appWithDb.db.query(
    'select * from decision_timeline_events where intent_id in (select id from human_intents where domain_id = $1) order by requested_at asc',
    [domainId]
  );
  return res.rows;
  });
}
