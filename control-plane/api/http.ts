
// Validate environment variables at startup


import cors from '@fastify/cors';
import Fastify, { FastifyRequest } from 'fastify';
import { validateEnv } from '@config';

import { getLogger } from '@kernel/logger';
import { getPoolInstance } from '@database/pool';

import { affiliateRoutes } from './routes/affiliates';
import { analyticsRoutes } from './routes/analytics';
import { attributionRoutes } from './routes/attribution';
import { authFromHeader } from '../services/auth';
import { billingInvoiceRoutes } from './routes/billing-invoices';
import { billingRoutes } from './routes/billing';
// C3-FIX: Removed contentListRoutes import (duplicate GET /content route)
import { contentRevisionRoutes } from './routes/content-revisions';
import { contentRoutes } from './routes/content';
import { contentScheduleRoutes } from './routes/content-schedule';
import { diligenceRoutes } from './routes/diligence';
import { domainDetailsRoutes } from './routes/domain-details';
import { domainOwnershipRoutes } from './routes/domain-ownership';
import { domainRoutes } from './routes/domains';
import { guardrailRoutes } from './routes/guardrails';
import { initializeContainer } from '../services/container';
import { initializeRateLimiter } from '../services/rate-limit';
import { getRedis } from '@kernel/redis';
import { llmRoutes } from './routes/llm';
import { mediaLifecycleRoutes } from './routes/media-lifecycle';
import { mediaRoutes } from './routes/media';
import { notificationAdminRoutes } from './routes/notifications-admin';
import { notificationRoutes } from './routes/notifications';
import { onboardingRoutes } from './routes/onboarding';
import { orgRoutes } from './routes/orgs';
import { planningRoutes } from './routes/planning';
import { portfolioRoutes } from './routes/portfolio';
import { publishingCreateJobRoutes } from './routes/publishing-create-job';
import { publishingPreviewRoutes } from './routes/publishing-preview';
import { publishingRoutes } from './routes/publishing';
import { queueMetricsRoutes } from './routes/queue-metrics';
import { queueRoutes } from './routes/queues';
import { registerAppsApiRoutes } from './routes/apps-api-routes';
import { roiRiskRoutes } from './routes/roi-risk';
import { searchRoutes } from './routes/search';
import { seoRoutes } from './routes/seo';
import { themeRoutes } from './routes/themes';
import { timelineRoutes } from './routes/timeline';
import { usageRoutes } from './routes/usage';

try {
  validateEnv();
  console.log('[startup] Environment variables validated successfully');
} catch (error) {
  console["error"]('[startup] Environment validation failed:', error instanceof Error ? error.message : error);
  process.exit(1);
}

const logger = getLogger('http');

const app = Fastify({
  logger: true,
  bodyLimit: 10 * 1024 * 1024, // 10MB max body size
  pluginTimeout: 30000, // 30 seconds for plugin registration
  // P2-MEDIUM FIX: Add explicit timeouts for better resource management
  requestTimeout: 30000,  // 30 seconds per request
  connectionTimeout: 5000, // 5 seconds for connection establishment
});

// Register CORS - allows frontend to communicate with API
// SECURITY FIX: Validate origin format and don't allow credentials with wildcard
const allowedOrigin = process.env['NEXT_PUBLIC_APP_URL'];
if (!allowedOrigin) {
  throw new Error('NEXT_PUBLIC_APP_URL environment variable is required');
}

// SECURITY FIX (Finding 21): Check for wildcard BEFORE parsing as URL
function validateOrigin(origin: string): string {
  // P0-FIX: Check for wildcard first - new URL('*') would throw, making the check unreachable
  if (origin === '*') {
    throw new Error('Wildcard origin not allowed when credentials=true');
  }
  try {
    new URL(origin);
    return origin;
  } catch {
    throw new Error(`Invalid origin format: ${origin}`);
  }
}

const validatedOrigin = validateOrigin(allowedOrigin);

await app.register(cors, {
  origin: validatedOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With', 'X-Request-ID']
});

// SECURITY FIX: Add security headers (HSTS, CSP, etc.)
app.addHook('onSend', async (request, reply, payload) => {
  // HSTS - HTTP Strict Transport Security
  reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  // Content Security Policy
  reply.header('Content-Security-Policy', 'default-src \'self\'; frame-ancestors \'none\';');

  // Prevent clickjacking
  reply.header('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  reply.header('X-Content-Type-Options', 'nosniff');

  // XSS Protection
  reply.header('X-XSS-Protection', '1; mode=block');

  // Referrer Policy
  reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy
  reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Prevent caching of sensitive authenticated responses
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
  reply.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  reply.header('Pragma', 'no-cache');
  reply.header('Expires', '0');
  }

  return payload;
});

// SECURITY FIX (Finding 5): Use shared pool from @database/pool instead of creating a duplicate
// Previously: new Pool({ max: 20 }) - created a second pool alongside the shared pool (max: 10)
// Combined: up to 30 connections per function * 100+ Vercel functions = connection storm
const pool = await getPoolInstance();

// Initialize DI container
const container = initializeContainer({ dbPool: pool });

// Initialize Redis rate limiter (falls back to in-memory if Redis unavailable)
try {
  initializeRateLimiter();
  logger.info('Redis rate limiter initialized');
} catch (error) {
  logger.warn('Redis rate limiter not available, using in-memory fallback');
}

// SECURITY FIX: P1-HIGH - Auth endpoint rate limiting (applied before auth check)
// Stricter rate limits for authentication endpoints to prevent brute force attacks
// Uses Redis for distributed rate limiting across multiple instances
const AUTH_RATE_LIMIT_MAX = 5; // 5 attempts
const AUTH_RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 minutes

// SECURITY FIX (Finding 4): In-memory fallback rate limiter for when Redis is unavailable
// Prevents brute force attacks even during Redis outages
// F12-FIX: Use LRU cache with max size to prevent unbounded memory growth.
// The previous Map only cleaned up when size > 1000, and the full iteration
// was O(n) causing latency spikes under sustained brute force attacks.
const MAX_RATE_LIMIT_ENTRIES = 10000;
const inMemoryRateLimitMap = new Map<string, { count: number; resetAt: number }>();

// F12-FIX: Periodic cleanup on interval instead of per-request check
const CLEANUP_INTERVAL_MS = 60000; // 1 minute
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of inMemoryRateLimitMap) {
    if (v.resetAt < now) inMemoryRateLimitMap.delete(k);
  }
}, CLEANUP_INTERVAL_MS).unref(); // unref() so it doesn't keep the process alive

function inMemoryRateLimit(key: string, max: number, windowMs: number): { allowed: boolean; retryAfter: number } {
  const now = Date.now();
  const entry = inMemoryRateLimitMap.get(key);

  // Evict oldest entry if at capacity
  if (inMemoryRateLimitMap.size >= MAX_RATE_LIMIT_ENTRIES && !entry) {
    const firstKey = inMemoryRateLimitMap.keys().next().value;
    if (firstKey) inMemoryRateLimitMap.delete(firstKey);
  }

  if (!entry || entry.resetAt < now) {
    inMemoryRateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  entry.count++;
  if (entry.count > max) {
    return { allowed: false, retryAfter: Math.ceil((entry.resetAt - now) / 1000) };
  }
  return { allowed: true, retryAfter: 0 };
}

app.addHook('onRequest', async (req, reply) => {
  // Check if this is an auth endpoint that needs stricter rate limiting
  const isAuthEndpoint = req.url?.startsWith('/login') ||
                         req.url?.startsWith('/auth') ||
                         req.url?.match(/\/(login|signin|signup|password-reset)$/);

  if (isAuthEndpoint) {
    const clientIp = req.ip || 'unknown';
    const windowSeconds = Math.ceil(AUTH_RATE_LIMIT_WINDOW / 1000);
    const key = `ratelimit:auth:${clientIp}`;

    try {
      const redis = await getRedis();
      const current = await redis.incr(key);

      if (current === 1) {
        // Set TTL on first request
        await redis.expire(key, windowSeconds);
      }

      if (current > AUTH_RATE_LIMIT_MAX) {
        const ttl = await redis.ttl(key);
        return reply.status(429).send({
          error: 'Too Many Requests',
          message: 'Too many authentication attempts. Please try again later.',
          retryAfter: ttl > 0 ? ttl : windowSeconds
        });
      }
    } catch (error) {
      // SECURITY FIX (Finding 4): Fall back to in-memory rate limiter instead of failing open
      logger.error('Redis rate limiting error, falling back to in-memory', error as Error);
      const result = inMemoryRateLimit(key, AUTH_RATE_LIMIT_MAX, AUTH_RATE_LIMIT_WINDOW);
      if (!result.allowed) {
        return reply.status(429).send({
          error: 'Too Many Requests',
          message: 'Too many authentication attempts. Please try again later.',
          retryAfter: result.retryAfter
        });
      }
    }
  }

  // P0-FIX: Auth middleware - rejects invalid auth by default (secure-by-default)
  // Previously: set auth = null and continued, relying on route-level checks (bypass vulnerability)
  // Now: rejects requests with invalid auth unless explicitly marked as public
  try {
    const authHeader = req.headers.authorization;

    // Check if route is marked as public (via route config or path pattern)
    const isPublicRoute = (req.routeOptions?.config as { public?: boolean })?.public === true ||
                         req.url?.startsWith('/health') ||
                         req.url?.startsWith('/webhooks/');

    if (!authHeader) {
      if (isPublicRoute) {
        (req as { auth: unknown }).auth = null;
        return;
      }
      // P0-FIX: Reject requests without auth to private routes
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required'
      });
    }

    (req as { auth: unknown }).auth = await authFromHeader(authHeader);
  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : 'Unauthorized';
    return reply.status(401).send({
      error: 'Unauthorized',
      message: errorMessage
    });
  }
});

// F9-FIX: Register BigInt serialization as a Fastify preSerialization hook.
// Previously this function existed but was never registered, causing
// TypeError crashes on any response containing BigInt values.
app.addHook('preSerialization', async (_request, _reply, payload) => {
  if (typeof payload === 'object' && payload !== null) {
    const json = JSON.stringify(payload, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    );
    return JSON.parse(json);
  }
  return payload;
});

// SECURITY FIX (Finding 8): Error handler using error properties instead of fragile string matching
app.setErrorHandler((error: unknown, request, reply) => {
  app.log["error"](error);

  // Determine appropriate status code using error properties, not string matching
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';

  const err = error as { code?: string; statusCode?: number; status?: number; name?: string; message?: string };

  // Check for explicit status code on the error object (Fastify/custom errors)
  if (err.statusCode && err.statusCode >= 400 && err.statusCode < 600) {
    statusCode = err.statusCode;
  } else if (err.status && err.status >= 400 && err.status < 600) {
    statusCode = err.status;
  }

  // Check for Fastify validation errors
  if (err.code === 'FST_ERR_VALIDATION') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
  } else if (err.name === 'TokenExpiredError' || err.name === 'TokenInvalidError' || err.name === 'AuthError') {
    statusCode = statusCode === 500 ? 401 : statusCode;
    errorCode = 'AUTH_ERROR';
  } else if (err.name === 'ZodError') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
  } else if (err.code === 'NOT_FOUND' || err.code === 'CONTENT_NOT_FOUND') {
    statusCode = 404;
    errorCode = 'NOT_FOUND';
  } else if (err.code === 'FORBIDDEN' || err.code === 'DOMAIN_NOT_OWNED') {
    statusCode = 403;
    errorCode = 'FORBIDDEN';
  } else if (err.code === 'CONFLICT') {
    statusCode = 409;
    errorCode = 'CONFLICT';
  } else if (statusCode !== 500) {
    // Status was set from error object properties above
    errorCode = statusCode === 400 ? 'VALIDATION_ERROR' :
                statusCode === 401 ? 'AUTH_ERROR' :
                statusCode === 403 ? 'FORBIDDEN' :
                statusCode === 404 ? 'NOT_FOUND' :
                statusCode === 409 ? 'CONFLICT' :
                statusCode === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR';
  }

  // P2-MEDIUM FIX: Only expose error details in development
  const isDevelopment = process.env['NODE_ENV'] === 'development';

  const response: {
  error: string;
  code: string;
  message?: string | undefined;
  stack?: string | undefined;
  details?: unknown | undefined;
  } = {
  error: statusCode === 500 ? 'Internal server error' : (err.message || 'An error occurred'),
  code: errorCode,
  };

  // F8-FIX: Only include sanitized error info in development.
  // Previously serialized the full raw error object which could contain
  // DB connection strings, internal paths, or secrets in error messages.
  if (isDevelopment) {
  response.message = err.message;
  // Never include raw error objects - they may contain sensitive data
  }

  reply.status(statusCode).send(response);
});

// 404 handler
app.setNotFoundHandler((request, reply) => {
  reply.status(404).send({ error: 'Route not found', code: 'NOT_FOUND' });
});

// Register all routes
async function registerRoutes(): Promise<void> {
  // Make container available to routes via app decorator
  app.decorate('container', container);

  // Core routes
  await planningRoutes(app, pool);
  await contentRoutes(app, pool);
  await domainRoutes(app, pool);
  await billingRoutes(app, pool);
  await orgRoutes(app, pool);
  await onboardingRoutes(app, pool);
  await notificationRoutes(app, pool);
  await searchRoutes(app, pool);
  await usageRoutes(app, pool);
  await seoRoutes(app, pool);
  await analyticsRoutes(app, pool);
  await publishingRoutes(app, pool);
  await mediaRoutes(app, pool);
  await queueRoutes(app, pool);

  // Additional routes
  // C3-FIX: Removed contentListRoutes — it registered a duplicate GET /content that conflicted
  // with contentRoutes above. The content.ts handler is the canonical one.
  await contentRevisionRoutes(app, pool);
  await contentScheduleRoutes(app);
  await domainOwnershipRoutes(app, pool);
  await guardrailRoutes(app, pool);
  await mediaLifecycleRoutes(app, pool);
  await notificationAdminRoutes(app, pool);
  await publishingCreateJobRoutes(app, pool);
  await publishingPreviewRoutes(app, pool);
  await queueMetricsRoutes(app, pool);

  // New routes to fix missing API endpoints
  await affiliateRoutes(app, pool);
  await diligenceRoutes(app, pool);
  await attributionRoutes(app, pool);
  await timelineRoutes(app, pool);
  await domainDetailsRoutes(app, pool);
  await themeRoutes(app, pool);
  await roiRiskRoutes(app, pool);
  await portfolioRoutes(app, pool);
  await llmRoutes(app, pool);
  await billingInvoiceRoutes(app, pool);

  // Migrated routes from apps/api/src/routes/
  await registerAppsApiRoutes(app, pool);
}

// P1-CRITICAL FIX: Deep health check with comprehensive dependency verification
app.get('/health', async (request, reply) => {
  const startTime = Date.now();

  // Run all health checks in parallel for faster response
  const checks = await Promise.allSettled([
    // Database health check
    checkDatabase(),
    // Redis health check
    checkRedisHealth(),
    // Queue health check (check for stalled/failed jobs)
    checkQueues(),
  ]);

  const [dbCheck, redisCheck, queueCheck] = checks;

  // Build detailed health report
  const health: HealthStatus = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    responseTime: Date.now() - startTime,
    checks: {
      database: dbCheck.status === 'fulfilled' ? { status: 'ok', ...dbCheck.value } : { status: 'error', error: String((dbCheck as PromiseRejectedResult).reason) },
      redis: redisCheck.status === 'fulfilled' ? { status: 'ok', ...redisCheck.value } : { status: 'error', error: String((redisCheck as PromiseRejectedResult).reason) },
      queues: queueCheck.status === 'fulfilled' ? { status: 'ok', ...queueCheck.value } : { status: 'error', error: String((queueCheck as PromiseRejectedResult).reason) },
    }
  };

  // Determine overall status
  const allHealthy = Object.values(health.checks).every(check => check.status === 'ok');
  const anyCriticalFailed = health.checks.database.status !== 'ok' || health.checks.redis.status !== 'ok';

  if (anyCriticalFailed) {
    health.status = 'unhealthy';
  } else if (!allHealthy) {
    health.status = 'degraded';
  }

  // Return 503 if unhealthy, 200 if healthy or degraded
  const statusCode = health.status === 'unhealthy' ? 503 : 200;
  return reply.status(statusCode).send(health);
});

// Health check result types
interface HealthCheckResult {
  status: 'ok' | 'error';
  latency?: number;
  error?: string;
}

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  responseTime: number;
  checks: {
    database: HealthCheckResult & { latency?: number };
    redis: HealthCheckResult & { latency?: number; mode?: string };
    queues: HealthCheckResult & { stalledJobs?: number; failedJobs?: number; pendingJobs?: number };
  };
}

/**
 * Check database connectivity and performance
 * SECURITY FIX (Finding 5): Uses the shared pool instance
 */
async function checkDatabase(): Promise<{ latency: number }> {
  const start = Date.now();
  const client = await pool.connect();
  try {
    await client.query('SELECT 1');
    return { latency: Date.now() - start };
  } finally {
    client.release();
  }
}

/**
 * Check Redis connectivity and performance
 * SECURITY FIX (Finding 3): Reuse the shared Redis client instead of creating new connections
 */
async function checkRedisHealth(): Promise<{ latency: number; mode: string }> {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    // Redis is optional - return healthy if not configured
    return { latency: 0, mode: 'not_configured' };
  }

  const start = Date.now();
  try {
    // Reuse the shared Redis connection from @kernel/redis
    const redis = await getRedis();
    await redis.ping();
    const info = await redis.info('server');
    const mode = info.includes('redis_mode:cluster') ? 'cluster' : 'standalone';
    return { latency: Date.now() - start, mode };
  } catch (error) {
    // If the shared client fails, report the error without creating a new connection
    throw error;
  }
}

/**
 * Check queue health - look for stalled and failed jobs
 */
async function checkQueues(): Promise<{ stalledJobs: number; failedJobs: number; pendingJobs: number }> {
  // Check for stalled jobs (running for too long)
  const stalledResult = await pool.query(
    `SELECT COUNT(*) as count FROM publishing_jobs
     WHERE status = 'processing'
     AND updated_at < NOW() - INTERVAL '30 minutes'`
  );

  // Check for failed jobs in the last hour
  const failedResult = await pool.query(
    `SELECT COUNT(*) as count FROM publishing_jobs
     WHERE status = 'failed'
     AND updated_at > NOW() - INTERVAL '1 hour'`
  );

  // Check pending jobs (backlog)
  const pendingResult = await pool.query(
    `SELECT COUNT(*) as count FROM publishing_jobs
     WHERE status IN ('pending', 'scheduled')`
  );

  const stalledJobs = parseInt(stalledResult.rows[0]?.count || '0', 10);
  const failedJobs = parseInt(failedResult.rows[0]?.count || '0', 10);
  const pendingJobs = parseInt(pendingResult.rows[0]?.count || '0', 10);

  // Alert if there are too many stalled jobs
  if (stalledJobs > 10) {
    throw new Error(`${stalledJobs} stalled jobs detected`);
  }

  return { stalledJobs, failedJobs, pendingJobs };
}

// F33-FIX: Detailed health endpoints require authentication.
// /health is public (for load balancer checks), but /health/detailed,
// /health/repositories, /health/sequences expose internal infrastructure state
// (DB latency, Redis mode, stalled jobs, sequence health) useful for reconnaissance.
app.get('/health/detailed', async (request, reply) => {
  if (!(request as { auth?: unknown }).auth) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required for detailed health checks' });
  }
  const containerHealth = await container.getHealth();
  return {
  status: containerHealth.services["database"] ? 'healthy' : 'degraded',
  services: containerHealth.services,
  details: containerHealth.details,
  };
});

// F33-FIX: Require auth for repository health check
app.get('/health/repositories', async (request, reply) => {
  if (!(request as { auth?: unknown }).auth) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
  }
  const { getRepositoryHealth } = await import('../services/repository-factory');
  return getRepositoryHealth();
});

// F33-FIX: Require auth for sequence health monitoring
app.get('/health/sequences', async (request, reply) => {
  if (!(request as { auth?: unknown }).auth) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
  }
  const { checkSequenceHealth } = await import('@database');
  const sequenceHealth = await checkSequenceHealth();

  return reply.status(sequenceHealth.healthy ? 200 : 503).send({
  healthy: sequenceHealth.healthy,
  sequences: sequenceHealth.sequences,
  checkedAt: new Date().toISOString(),
  });
});

// Start server
async function start(): Promise<void> {
  try {
  await registerRoutes();
  const port = parseInt(process.env['PORT'] || '3000');
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`Server started on port ${port}`);
  } catch (error) {
  logger["error"]('Failed to start server', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
  }
}

start();

export { app, pool };
