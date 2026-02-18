import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getAuthContext } from '../types';
import { requireRole } from '../../services/auth';
import { getGlobalCache } from '@smartbeak/cache';
import { getLogger } from '@kernel/logger';

const logger = getLogger('CacheRoutes');

const CacheKeysQuerySchema = z.object({
  pattern: z.string().max(200).optional(),
  offset: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

const CacheKeyParamsSchema = z.object({
  key: z.string().min(1).max(500),
});

const CacheClearBodySchema = z.object({
  tier: z.enum(['l1', 'l2', 'all']),
});

export async function cacheRoutes(app: FastifyInstance, _pool: Pool): Promise<void> {
  // GET /admin/cache/stats - Cache statistics and memory usage
  app.get('/admin/cache/stats', async (req, _res) => {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin']);

    const cache = getGlobalCache();
    const stats = cache.getStats();
    const l1Size = cache.getL1Size();
    const mem = process.memoryUsage();

    return {
      stats,
      l1Size,
      memory: {
        heapUsed: mem.heapUsed,
        heapTotal: mem.heapTotal,
        external: mem.external,
        rss: mem.rss,
      },
    };
  });

  // GET /admin/cache/keys - List L1 cache keys with optional pattern filter
  app.get('/admin/cache/keys', async (req, res) => {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner', 'admin']);

    const queryResult = CacheKeysQuerySchema.safeParse(req.query);
    if (!queryResult.success) {
      return res.status(400).send({
        error: 'Invalid query parameters',
        code: 'VALIDATION_ERROR',
        details: queryResult.error.issues,
      });
    }

    const { pattern, offset, limit } = queryResult.data;
    const cache = getGlobalCache();
    let allKeys = cache.getL1Keys();

    if (pattern) {
      try {
        // Escape all regex metacharacters before expanding glob wildcards to prevent ReDoS.
        const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp('^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$');
        allKeys = allKeys.filter(key => regex.test(key));
      } catch {
        return res.status(400).send({
          error: 'Invalid search pattern',
          code: 'INVALID_PATTERN',
        });
      }
    }

    const total = allKeys.length;
    const keys = allKeys.slice(offset, offset + limit);

    return { keys, total, offset, limit };
  });

  // DELETE /admin/cache/keys/:key - Delete a specific cache key
  app.delete('/admin/cache/keys/:key', async (req, res) => {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner']);

    const paramsResult = CacheKeyParamsSchema.safeParse(req.params);
    if (!paramsResult.success) {
      return res.status(400).send({
        error: 'Invalid cache key',
        code: 'VALIDATION_ERROR',
        details: paramsResult.error.issues,
      });
    }

    const { key } = paramsResult.data;
    const cache = getGlobalCache();

    // L1 keys include the prefix already. Strip it so cache.delete() can re-add it.
    const prefix = 'cache:';
    const unprefixed = key.startsWith(prefix) ? key.slice(prefix.length) : key;

    await cache.delete(unprefixed);
    logger.info(`Cache key deleted by admin: ${key}`, { userId: ctx.userId });

    return { ok: true, key };
  });

  // POST /admin/cache/clear - Clear cache by tier
  app.post('/admin/cache/clear', async (req, res) => {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner']);

    const bodyResult = CacheClearBodySchema.safeParse(req.body);
    if (!bodyResult.success) {
      return res.status(400).send({
        error: 'Invalid request body',
        code: 'VALIDATION_ERROR',
        details: bodyResult.error.issues,
      });
    }

    const { tier } = bodyResult.data;
    const cache = getGlobalCache();

    if (tier === 'l1') {
      cache.clearL1();
    } else if (tier === 'l2') {
      await cache.clearL2();
    } else {
      await cache.clearAll();
    }

    logger.info(`Cache cleared (tier: ${tier}) by admin`, { userId: ctx.userId, tier });

    return { ok: true, tier };
  });

  // POST /admin/cache/stats/reset - Reset cache statistics
  app.post('/admin/cache/stats/reset', async (req, _res) => {
    const ctx = getAuthContext(req);
    requireRole(ctx, ['owner']);

    const cache = getGlobalCache();
    cache.resetStats();
    logger.info('Cache stats reset by admin', { userId: ctx.userId });

    return { ok: true };
  });
}
