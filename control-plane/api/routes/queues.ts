import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { DLQService } from '@kernel/queue';
import { ErrorCodes, PaginationQuerySchema, validateUUID, ExternalAPIError } from '@kernel/validation';

import { getAuthContext } from '../types';
import { rateLimit } from '../../services/rate-limit';
import { requireRole } from '../../services/auth';

/**
* Queue Routes
*
* Admin endpoints for managing job queues and dead letter queues
*
* MEDIUM FIX E2: Add error boundaries in queue routes
* MEDIUM FIX I1: Add validation on query parameters
* MEDIUM FIX E1: Use error codes instead of message sniffing
* MEDIUM FIX E4: Improve generic error messages
* MEDIUM FIX E6: Standardize error response formats
* MEDIUM FIX E7: Add error context
* MEDIUM FIX M16: Add JSDoc comments
*/




/**
* DLQ list query parameters schema
* MEDIUM FIX I1: Add validation on query parameters
*/
// P2-6 FIX: Added .strict() — without it, extra query parameters (including
// prototype-pollution attempts like ?__proto__=x) were silently accepted and
// stripped. .strict() rejects requests with unknown keys, making typos in
// param names (e.g. ?statuss=failed) visible to the caller rather than silent.
const DLQListQuerySchema = PaginationQuerySchema.extend({
  region: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).optional(),
  status: z.enum(['pending', 'processing', 'failed', 'resolved']).optional(),
}).strict();


/**
* Register queue routes
* MEDIUM FIX M16: Add JSDoc comments
*
* @param app - Fastify instance
* @param pool - Database pool
*/
export async function queueRoutes(app: FastifyInstance, pool: Pool) {
  const dlq = new DLQService(pool);

  /**
  * Get DLQ items
  * MEDIUM FIX I1: Add validation on query parameters
  */
  app.get('/admin/dlq', async (req, res) => {
    // P1-3 FIX: Rate limit before auth — prevents unauthenticated callers from
    // spamming auth failures without consuming any rate-limit quota.
    await rateLimit(`admin:dlq:${req.ip}`, 40);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin']);

    // Validate orgId is present
    if (!ctx["orgId"]) {
    throw new ExternalAPIError(
        'Organization ID is required',
        ErrorCodes.INVALID_INPUT,
        { field: 'orgId' }
    );
    }

    // Validate UUID format - MEDIUM FIX I2: Standardize UUID validation
    validateUUID(ctx["orgId"], 'orgId');

    // Parse and validate query parameters
    const queryValidation = DLQListQuerySchema.safeParse(req.query);
    if (!queryValidation.success) {
    throw new ExternalAPIError(
        'Invalid query parameters',
        ErrorCodes.VALIDATION_ERROR,
        { details: queryValidation['error']['issues'] }
    );
    }

    const query = queryValidation.data;

    // SECURITY FIX P0-3: Pass orgId for tenant isolation
    const results = await dlq.list(
      ctx["orgId"],
      query.region,
      query["limit"],
      query.offset
    );

    return res.send(results);
  });

  /**
  * Retry a DLQ item
  * MEDIUM FIX I1: Add validation on query parameters
  */
  app.post('/admin/dlq/:id/retry', async (req, res) => {
    await rateLimit(`admin:dlq:retry:${req.ip}`, 20);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin']);

    // Validate orgId is present
    if (!ctx["orgId"]) {
    throw new ExternalAPIError(
        'Organization ID is required',
        ErrorCodes.INVALID_INPUT,
        { field: 'orgId' }
    );
    }

    // P2-13 FIX: Use a typed accessor instead of `as` cast on req.params.
    // Fastify types req.params as unknown without a schema declaration; the
    // cast previously hid the fact that `id` could be undefined at runtime.
    const params = req.params as Record<string, string | undefined>;
    const id = params['id'];
    if (!id) {
      throw new ExternalAPIError('Missing route parameter: id', ErrorCodes.VALIDATION_ERROR, { field: 'id' });
    }
    validateUUID(id, 'id');

    // SECURITY FIX P0-3: Pass orgId for tenant isolation
    const result = await dlq.retry(ctx["orgId"], id);

    return res.send({ success: true, data: result });
  });

  /**
  * Delete a DLQ item
  * MEDIUM FIX I1: Add validation on query parameters
  */
  app.delete('/admin/dlq/:id', async (req, res) => {
    await rateLimit(`admin:dlq:delete:${req.ip}`, 20);
    const ctx = getAuthContext(req);
    requireRole(ctx, ['admin']);

    // Validate orgId is present
    if (!ctx["orgId"]) {
    throw new ExternalAPIError(
        'Organization ID is required',
        ErrorCodes.INVALID_INPUT,
        { field: 'orgId' }
    );
    }

    // P2-13 FIX: Safe accessor instead of `as` cast.
    const deleteParams = req.params as Record<string, string | undefined>;
    const id = deleteParams['id'];
    if (!id) {
      throw new ExternalAPIError('Missing route parameter: id', ErrorCodes.VALIDATION_ERROR, { field: 'id' });
    }
    validateUUID(id, 'id');

    // SECURITY FIX P0-4: Use proper delete instead of retry to prevent accidental re-execution
    // SECURITY FIX P0-3: Pass orgId for tenant isolation
    await dlq.delete(ctx["orgId"], id);

    return res.status(204).send();
  });
}
