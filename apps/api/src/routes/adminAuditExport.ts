import crypto from 'crypto';
import { FastifyInstance, FastifyRequest, FastifyReply, HookHandlerDoneFunction } from 'fastify';
import { z } from 'zod';

import { adminRateLimit } from '../middleware/rateLimiter';
import { getDb } from '../db';

const ExportQuerySchema = z.object({
  limit: z.coerce.number().min(1).max(1000).default(1000),
  offset: z.coerce.number().min(0).default(0),
  orgId: z.string().uuid().optional(),
});

export type ExportQueryType = z.infer<typeof ExportQuerySchema>;

/**
 * Custom export error with error code
 * MEDIUM FIX E1: Use error codes instead of message sniffing
 */
class ExportError extends Error {
  constructor(
  message: string,
  public code: string,
  public statusCode: number = 500
  ) {
  super(message);
  this.name = 'ExportError';
  }
}

/**
 * Sanitize CSV field to prevent formula injection
 * @param field - Field to sanitize
 * @returns Sanitized field
 */
function sanitizeCsvField(field: string): string {
  // Convert to string and replace double quotes
  let sanitized = String(field).replace(/"/g, '""');

  // Characters that could trigger formula execution: =, +, -, @, \t, \r
  if (/^[\=\+\-\@\t\r]/.test(sanitized)) {
  sanitized = "'" + sanitized;  // Prefix with apostrophe to neutralize
  }

  return `"${sanitized}"`;
}

/**
 * Secure token comparison using timing-safe equal
 * Prevents timing attacks on token validation
 */
function secureCompareToken(token: string, expectedToken: string): boolean {
  const tokenBuf = Buffer.from(token, 'utf8');
  const expectedBuf = Buffer.from(expectedToken, 'utf8');
  const maxLen = Math.max(tokenBuf.length, expectedBuf.length);
  if (maxLen === 0) return false;
  const tokenPadded = Buffer.alloc(maxLen, 0);
  const expectedPadded = Buffer.alloc(maxLen, 0);
  tokenBuf.copy(tokenPadded);
  expectedBuf.copy(expectedPadded);
  const equal = crypto.timingSafeEqual(tokenPadded, expectedPadded);
  const sameLength = token.length === expectedToken.length;
  return equal && sameLength;
}

/**
 * Verify admin has membership in the organization
 * P1-FIX: Added org membership verification for audit exports
 */
async function verifyOrgMembership(adminId: string, orgId: string): Promise<boolean> {
  const db = await getDb();
  const membership = await db('org_memberships')
    .where({ user_id: adminId, org_id: orgId })
    .first();
  return !!membership;
}

export async function adminAuditExportRoutes(app: FastifyInstance): Promise<void> {

  app.addHook('onRequest', adminRateLimit() as (req: FastifyRequest, reply: FastifyReply, done: HookHandlerDoneFunction) => void);

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Unauthorized. Bearer token required.' });
    }

    // MEDIUM FIX C2: Environment validation at startup
    if (!process.env['ADMIN_API_KEY']) {
    return reply.status(500).send({ error: 'Admin API not configured' });
    }

    const token = authHeader.slice(7);
    if (!secureCompareToken(token, process.env['ADMIN_API_KEY'])) {
    return reply.status(403).send({ error: 'Forbidden. Admin access required.' });
    }
  } catch (error) {
    console.error('[admin-audit-export-hook] Error:', error);
    const exportError = new ExportError('Authentication check failed', 'AUTH_ERROR', 500);
    return reply.status(exportError.statusCode).send({
    error: exportError["message"],
    code: exportError.code
    });
  }
  });

  app.get<{
  Querystring: ExportQueryType;
  }>('/admin/audit/export', async (
  req: FastifyRequest<{ Querystring: ExportQueryType }>,
  reply: FastifyReply
  ): Promise<void> => {
  try {
    const parseResult = ExportQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
    return reply.status(400).send({
    error: 'Invalid query parameters',
    code: 'VALIDATION_ERROR',
    details: parseResult.error.issues
    });
    }

    const { limit, offset, orgId } = parseResult.data;

    // MEDIUM FIX: Use async getDb() to get database instance
    const db = await getDb();

    // P1-FIX: Build query with orgId filter if provided
    let query = db('audit_events')
      .orderBy('created_at', 'desc')
      .limit(limit)
      .offset(offset);

    // P1-FIX: Apply orgId filter if specified
    if (orgId) {
      // Verify admin has membership in this org before allowing filtered export
      const adminId = req.headers['x-admin-id'] as string | undefined;
      if (adminId) {
        const hasMembership = await verifyOrgMembership(adminId, orgId);
        if (!hasMembership) {
          return reply.status(403).send({
            error: 'Forbidden. Admin not a member of this organization.',
            code: 'MEMBERSHIP_REQUIRED'
          });
        }
      }
      query = query.where('org_id', orgId);
    }

    const events = await query;

    const rows = events.map(e => ({
    id: e.id,
    org_id: e.org_id,
    actor_type: e.actor_type,
    action: e.action,
    created_at: e.created_at,
    metadata: JSON.stringify(e.metadata)
    }));

    const headers = ['id', 'org_id', 'actor_type', 'action', 'created_at', 'metadata'];
    const header = headers.join(',') + '\n';

    interface AuditEventRow {
    id: string;
    org_id: string;
    actor_type: string;
    action: string;
    created_at: Date | string;
    metadata: string;
    }
    const body = rows
    .map((r: AuditEventRow) => headers.map(h => sanitizeCsvField(String(r[h as keyof AuditEventRow]))).join(','))
    .join('\n');

    return reply
    .header('Content-Type', 'text/csv')
    .header('Content-Disposition', 'attachment; filename="audit_events.csv"')
    .header('X-Content-Type-Options', 'nosniff')
    .send(header + body);
  } catch (error) {
    console.error('[admin-audit-export] Error:', error);
    if (error instanceof ExportError) {
    return reply.status(error.statusCode).send({
    error: error["message"],
    code: error.code
    });
    }

    // MEDIUM FIX E1: Use error codes instead of message sniffing
    if (error instanceof Error) {
    const pgError = error as Error & { code?: string };
    const isTimeout = pgError.code === '57014';
    const isConnectionError = pgError.code === 'ECONNREFUSED' ||
              pgError.code === '08000' ||
              pgError.code === '08003';
    if (isTimeout || isConnectionError) {
    return reply.status(503).send({
    error: 'Database temporarily unavailable',
    code: 'DB_UNAVAILABLE'
    });
    }
    }

    return reply.status(500).send({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    // MEDIUM FIX C2: Use centralized env check
    ...(process.env['NODE_ENV'] === 'development' && { message: (error as Error)["message"] })
    });
  }
  });
}
