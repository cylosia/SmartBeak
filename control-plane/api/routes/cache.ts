import { FastifyInstance } from 'fastify';
import { Pool } from 'pg';
import { z } from 'zod';

import { getAuthContext } from '../types';
import { requireRole } from '../../services/auth';
import { getGlobalCache } from '@smartbeak/cache';
import { getLogger } from '@kernel/logger';
import { errors } from '@errors/responses';

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
      return errors.validationFailed(res, queryResult.error.issues);
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
      } catch (patternErr: unknown) {
        // P2-FIX: Log the pattern and error so operators can diagnose malformed
        // patterns instead of silently swallowing the failure.
        logger.warn('Cache key pattern compilation failed', { pattern }, patternErr instanceof Error ? patternErr : new Error(String(patternErr)));
        return errors.badRequest(res, 'Invalid search pattern');
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
      return errors.validationFailed(res, paramsResult.error.issues);
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
      return errors.validationFailed(res, bodyResult.error.issues);
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
