/**
 * Shard Deployment API Routes
 *
 * POST /shards/deploy - Deploy a new version of a site shard
 * POST /shards/:id/rollback - Rollback to a previous version
 * GET /shards/:siteId/versions - List all versions for a site
 *
 * SECURITY FIXES:
 * - P0 #4: Added authorization checks to all routes
 * - P1 #13: Sanitized error messages to prevent information disclosure
 * - P1 #17: Added themeId validation against known themes
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getKnex } from '../../../packages/database';
import {
  createShardVersion,
  deployShardToVercel,
  listShardVersions,
  rollbackShard,
} from '../../services/shard-deployment';
import { generateShardFiles, VALID_THEME_IDS } from '../../services/shard-generator';
import type { ThemeConfig } from '../../services/shard-generator';
import { errors } from '@errors/responses';

// ── ThemeConfig Zod schema ─────────────────────────────────────────────────
// P1-FIX: Validate themeConfig against ThemeConfig schema before passing to
// generateShardFiles(). Previously themeConfig was typed as Record<string, unknown>
// and cast implicitly; missing required fields (siteName, primaryColor) caused
// silent crashes or XSS-safe-but-wrong template output.
const ThemeConfigSchema = z.object({
  siteName: z.string().min(1).max(500),
  siteDescription: z.string().max(1000).optional(),
  primaryColor: z.string().min(1).max(50),
  secondaryColor: z.string().max(50).optional(),
  logoUrl: z.string().url().max(2000).optional(),
  socialLinks: z.object({
    twitter: z.string().url().max(2000).optional(),
    facebook: z.string().url().max(2000).optional(),
    instagram: z.string().url().max(2000).optional(),
  }).optional(),
  customCss: z.string().max(50000).optional(),
  metaTags: z.record(z.string(), z.string()).optional(),
}).strict();

// ── Request body schemas ───────────────────────────────────────────────────
const DeployBodySchema = z.object({
  siteId: z.string().min(1).max(255),
  themeId: z.string().min(1).max(100),
  themeConfig: ThemeConfigSchema,
  vercelProjectId: z.string().min(1).max(255),
}).strict();

const RollbackBodySchema = z.object({
  targetVersion: z.number().int().positive(),
  vercelProjectId: z.string().min(1).max(255),
}).strict();

/**
 * Verify the authenticated user owns the given siteId.
 * SECURITY FIX P0 #4: Prevent IDOR on shard operations.
 */
async function verifySiteOwnership(
  request: FastifyRequest,
  siteId: string
): Promise<boolean> {
  const user = (request as FastifyRequest & { user?: { orgId?: string } }).user;
  if (!user?.orgId) return false;

  const db = await getKnex();
  const site = await db('sites')
    .where({ id: siteId, org_id: user.orgId })
    .first();

  return !!site;
}

export default async function shardRoutes(fastify: FastifyInstance) {

  /**
   * Deploy a new shard version
   */
  fastify.post('/deploy', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const parseResult = DeployBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return errors.badRequest(reply, `Invalid request body: ${parseResult.error.issues.map(i => i.message).join(', ')}`);
      }
      const body = parseResult.data;

      // SECURITY FIX P1 #17: Validate themeId against known themes
      if (!VALID_THEME_IDS.includes(body.themeId)) {
        return errors.badRequest(reply, `Invalid themeId. Must be one of: ${VALID_THEME_IDS.join(', ')}`);
      }

      // SECURITY FIX P0 #4: Verify site ownership
      if (!(await verifySiteOwnership(request, body.siteId))) {
        return errors.forbidden(reply);
      }

      // 1. Generate shard files from template
      const files = generateShardFiles(body.themeId, body.themeConfig as ThemeConfig);

      // 2. Save to storage and database
      const { shardId } = await createShardVersion(
        {
          siteId: body.siteId,
          themeId: body.themeId,
          themeConfig: body.themeConfig as unknown as Record<string, unknown>,
        },
        files
      );

      // 3. Deploy to Vercel
      const deployment = await deployShardToVercel(shardId, body.vercelProjectId);

      if (!deployment.success) {
        return errors.internal(reply, 'Deployment failed');
      }

      return reply.send({
        success: true,
        shardId,
        deploymentId: deployment.deploymentId,
        url: deployment.url,
      });

    } catch (error) {
      // SECURITY FIX P1 #13: Don't expose internal error messages
      fastify.log.error(error);
      return errors.internal(reply);
    }
  });

  /**
   * List all shard versions for a site
   */
  fastify.get('/:siteId/versions', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { siteId } = request.params as { siteId: string };

      // SECURITY FIX P0 #4: Verify site ownership
      if (!(await verifySiteOwnership(request, siteId))) {
        return errors.forbidden(reply);
      }

      const versions = await listShardVersions(siteId);

      return reply.send({
        siteId,
        versions: versions.map((v: { id: string; version: number; status: string; vercel_url: string; created_at: string; deployed_at: string }) => ({
          id: v.id,
          version: v.version,
          status: v.status,
          url: v.vercel_url,
          createdAt: v.created_at,
          deployedAt: v.deployed_at,
        })),
      });

    } catch (error) {
      fastify.log.error(error);
      return errors.internal(reply, 'Failed to fetch versions');
    }
  });

  /**
   * Rollback to a specific version
   */
  fastify.post('/:siteId/rollback', async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const { siteId } = request.params as { siteId: string };
      const parseResult = RollbackBodySchema.safeParse(request.body);
      if (!parseResult.success) {
        return errors.badRequest(reply, `Invalid request body: ${parseResult.error.issues.map(i => i.message).join(', ')}`);
      }
      const { targetVersion, vercelProjectId } = parseResult.data;

      // SECURITY FIX P0 #4: Verify site ownership
      if (!(await verifySiteOwnership(request, siteId))) {
        return errors.forbidden(reply);
      }

      const result = await rollbackShard(siteId, targetVersion, vercelProjectId);

      if (!result.success) {
        return errors.internal(reply, 'Rollback failed');
      }

      return reply.send({
        success: true,
        deploymentId: result.deploymentId,
        url: result.url,
      });

    } catch (error) {
      fastify.log.error(error);
      return errors.internal(reply, 'Rollback failed');
    }
  });
}
