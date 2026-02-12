
import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getLogger } from '@kernel/logger';

const logger = getLogger('diligence-exports');

export interface TokenParams {
  token: string;
}

// H02-FIX: Validate token via Zod instead of unsafe `as` cast
const TokenParamSchema = z.object({
  token: z.string().min(10).max(100).regex(/^[a-zA-Z0-9_-]+$/)
});

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

  return {
    generated_at: new Date().toISOString(),
    source: 'ACP system of record',
    snapshot: snapshot.rows[0] ?? null
  };
  });

  app.get('/diligence/:token/export/csv', async (req, reply) => {
  const parseResult = TokenParamSchema.safeParse(req.params);
  if (!parseResult.success) return reply.code(400).send({ error: 'Invalid token format' });
  const { token } = parseResult.data;
  const session = await appWithDb.db.diligence_sessions.findActiveByToken(token);
  if (!session) return reply.code(403).send({ error: 'Invalid or expired token' });

  const res = await appWithDb.db.query(
    'SELECT domain_id, domain_name, traffic_monthly, revenue_monthly, content_count, niche, age_years, created_at FROM diligence_domain_snapshot WHERE domain_id = $1',
    [session.domain_id]
  );

  // H04-FIX: Check for empty result set before accessing row properties
  if (!res.rows[0]) {
    return reply.code(404).send({ error: 'No diligence data found for this domain' });
  }

  const row = res.rows[0] as Record<string, unknown>;
  // SECURITY FIX: Sanitize CSV values to prevent formula injection
  const headers = Object.keys(row).map(sanitizeCsvCell).join(',');
  const values = Object.values(row).map(sanitizeCsvCell).join(',');
  const csv = headers + '\n' + values;

  reply.header('Content-Type', 'text/csv');
  reply.send(csv);
  });

  app.get('/diligence/:token/export/pdf', async (req, reply) => {
  const parseResult = TokenParamSchema.safeParse(req.params);
  if (!parseResult.success) return reply.code(400).send({ error: 'Invalid token format' });
  const { token } = parseResult.data;
  const session = await appWithDb.db.diligence_sessions.findActiveByToken(token);
  if (!session) return reply.code(403).send({ error: 'Invalid or expired token' });

  // H05-FIX: Return 501 Not Implemented instead of sending JSON with wrong Content-Type.
  // Sending raw JSON with Content-Type: application/pdf is a MIME confusion vulnerability.
  return reply.code(501).send({
    error: 'PDF export is not yet implemented',
    alternative: 'Use /export/json or /export/csv instead'
  });
  });
}
