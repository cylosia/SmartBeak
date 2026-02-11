

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';

import { AuthContext } from '../types/fastify';
import { getDb } from '../db';
import { rateLimit } from '../utils/rateLimit';
import { getLogger } from '../../../../packages/kernel/logger';

const logger = getLogger('PublishRetryService');

function requireRole(auth: AuthContext, allowedRoles: string[]): void {
  const hasRole = auth.roles.some(role => allowedRoles.includes(role));
  if (!hasRole) {
  throw new Error('permission denied: insufficient role');
  }
}

export interface PublishIntent {
  id: string;
  status: string;
  org_id: string;
  domain_id: string;
}

const ParamsSchema = z.object({
  id: z.string().uuid(),
});

export type ParamsType = z.infer<typeof ParamsSchema>;

export interface RetryRouteParams {
  Params: ParamsType;
}

/**
* Publish retry routes
* MEDIUM FIX: Add proper types, validation, and error handling
*/
export async function publishRetryRoutes(app: FastifyInstance): Promise<void> {
  app.post<RetryRouteParams>('/publish/intents/:id/retry', async (
  req: FastifyRequest<RetryRouteParams>,
  reply: FastifyReply
  ): Promise<void> => {
  try {
    const auth = req.auth;
    if (!auth) {
    reply.status(401).send({
    error: 'Unauthorized',
    code: 'UNAUTHORIZED'
    });
    return;
    }

    requireRole(auth, ['owner', 'admin']);

    // RATE LIMITING: Write endpoint - 30 requests/minute
    await rateLimit('publish:retry', 30, req, reply);

    const paramsResult = ParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
    reply.status(400).send({
    error: 'Invalid ID format',
    code: 'VALIDATION_ERROR',
    details: paramsResult.error.issues
    });
    return;
    }

    const { id } = paramsResult.data;

    const db = await getDb();

    let intent: PublishIntent | undefined;
    try {
    intent = await db('publish_intents')
    .where({ id })
    .where('org_id', auth.orgId) // Ensure ownership
    .first();
    } catch (dbError) {
        logger.error('Database error', dbError as Error);
    reply.status(503).send({
    error: 'Database temporarily unavailable',
    code: 'DB_UNAVAILABLE',
    message: 'Unable to fetch publish intent. Please try again later.'
    });
    return;
    }

    if (!intent) {
    reply.code(404).send({
    error: 'Publish intent not found',
    code: 'NOT_FOUND'
    });
    return;
    }

    if (intent.status !== 'failed') {
    reply.code(400).send({
    error: 'Only failed intents can be retried',
    code: 'INVALID_STATE'
    });
    return;
    }

    // Enqueue publish_execution_job (idempotent)
    try {
    const db2 = await getDb();
    await db2('publish_intents')
    .where({ id })
    .where('org_id', auth.orgId)
    .update({ status: 'pending' });
    } catch (dbError) {
        logger.error('Update error', dbError as Error);
    reply.status(503).send({
    error: 'Failed to retry',
    code: 'UPDATE_FAILED',
    message: 'Unable to update publish intent. Please try again later.'
    });
    return;
    }

    reply.send({ status: 'requeued', intentId: id });
  } catch (error) {
    logger.error('Unexpected error', error as Error);

    // Check for permission error using error code or specific error type
    const hasPermissionError = error instanceof Error &&
    (error["message"].includes('permission') ||
    (error as Error & { code?: string }).code === 'PERMISSION_DENIED');
    if (hasPermissionError) {
    reply.status(403).send({
    error: 'Permission denied',
    code: 'FORBIDDEN'
    });
    return;
    }

    // FIX: Added return before reply.send()
    return reply.status(500).send({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR',
    message: error instanceof Error ? error["message"] : 'Unknown error'
    });
  }
  });
}
