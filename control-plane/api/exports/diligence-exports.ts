
import { FastifyInstance } from 'fastify';

export interface TokenParams {
  token: string;
}

// Extend FastifyInstance to include db
interface FastifyInstanceWithDb extends FastifyInstance {
  db: {
    diligence_sessions: {
      findActiveByToken: (token: string) => Promise<{ domain_id: string } | null>;
    };
    query: (sql: string, params?: unknown[]) => Promise<{ rows: unknown[] }>;
  };
}

/**
* SECURITY FIX: Sanitize CSV cell to prevent formula injection
* Prefixes formula-triggering characters (=, +, -, @) with apostrophe
*/
function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  // Prevent CSV formula injection by prefixing dangerous characters with apostrophe
  if (/^[+=\-@]/.test(str)) {
  return `'${str}`;
  }
  // Escape quotes and wrap in quotes if contains comma, newline, or quote
  if (str.includes(',') || str.includes('\n') || str.includes('"')) {
  return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function registerDiligenceExportRoutes(app: FastifyInstance) {
  const appWithDb = app as FastifyInstanceWithDb;
  
  app.get('/diligence/:token/export/json', async (req, reply) => {
  const { token } = req.params as TokenParams;
  const session = await appWithDb.db.diligence_sessions.findActiveByToken(token);
  if (!session) return reply.code(403).send({ error: 'Invalid or expired token' });

  const snapshot = await appWithDb.db.query(
    'select * from diligence_domain_snapshot where domain_id = $1',
    [session.domain_id]
  );

  return {
    generated_at: new Date().toISOString(),
    source: 'ACP system of record',
    snapshot: snapshot.rows[0]
  };
  });

  app.get('/diligence/:token/export/csv', async (req, reply) => {
  const { token } = req.params as TokenParams;
  const session = await appWithDb.db.diligence_sessions.findActiveByToken(token);
  if (!session) return reply.code(403).send({ error: 'Invalid or expired token' });

  const res = await appWithDb.db.query(
    'select * from diligence_domain_snapshot where domain_id = $1',
    [session.domain_id]
  );

  const row = res.rows[0] as Record<string, unknown>;
  // SECURITY FIX: Sanitize CSV values to prevent formula injection
  const headers = Object.keys(row).map(sanitizeCsvCell).join(',');
  const values = Object.values(row).map(sanitizeCsvCell).join(',');
  const csv = headers + '\n' + values;

  reply.header('Content-Type', 'text/csv');
  reply.send(csv);
  });

  app.get('/diligence/:token/export/pdf', async (req, reply) => {
  const { token } = req.params as TokenParams;
  const session = await appWithDb.db.diligence_sessions.findActiveByToken(token);
  if (!session) return reply.code(403).send({ error: 'Invalid or expired token' });

  const snapshot = await appWithDb.db.query(
    'select * from diligence_domain_snapshot where domain_id = $1',
    [session.domain_id]
  );

  // Minimal PDF placeholder (text-based)
  const content = JSON.stringify(snapshot.rows[0], null, 2);
  reply.header('Content-Type', 'application/pdf');
  reply.send(Buffer.from(content));
  });
}
