import { FastifyInstance, FastifyRequest } from 'fastify';
import { Pool } from 'pg';

import { PublishingPreviewService } from '../../services/publishing-preview';
import { rateLimit } from '../../services/rate-limit';
import { requireRole, AuthContext } from '../../services/auth';
import { errors } from '@errors/responses';
import { ErrorCodes } from '@errors';




/**
* Query parameters for preview requests
*/
export interface PreviewQueryParams {
  content_id?: string;
  org_id?: string;
}

/**
* Authenticated request with typed params
*/
export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

/**
* @openapi
* /publishing/preview/facebook:
*   get:
*     summary: Get Facebook preview for content
*     tags: [Publishing]
*     security:
*       - bearerAuth: []
*     parameters:
*       - name: content_id
*         in: query
*         required: true
*         schema:
*           type: string
*           format: uuid
*     responses:
*       200:
*         description: Preview generated
*       400:
*         description: Invalid request
*       403:
*         description: Forbidden
*
*/
export async function publishingPreviewRoutes(app: FastifyInstance, pool: Pool) {
  const svc = new PublishingPreviewService(pool);

  app.get('/publishing/preview/facebook', async (req, res) => {
    // P1-FIX: Rate limit before auth to prevent DoS via 3 DB queries per request.
    await rateLimit('publishing', 50);

    const { auth: ctx, query } = req as AuthenticatedRequest & { query: PreviewQueryParams };
    if (!ctx) {
    return errors.unauthorized(res);
    }
    requireRole(ctx, ['owner','admin','editor','viewer']);

    const content_id = query.content_id;
    // P2-FIX: The OpenAPI schema declares format:uuid but the route only checked
    // `typeof !== 'string'`, accepting arbitrary strings. Enforce UUID format
    // so downstream parameterized queries receive valid IDs only.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!content_id || typeof content_id !== 'string' || !UUID_RE.test(content_id)) {
    return errors.badRequest(res, 'Missing or invalid content_id: must be a UUID', ErrorCodes.MISSING_PARAMETER);
    }

    const result = await svc.facebookPreview(content_id, ctx["orgId"]);
    return res.send(result);
  });
}
