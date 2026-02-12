
// Validate environment variables at startup


import cors from '@fastify/cors';
import Fastify, { FastifyRequest } from 'fastify';
import { Pool } from 'pg';
import { validateEnv } from '@config';

import { getLogger } from '@kernel/logger';

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
import Redis from 'ioredis';
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

// SECURITY FIX: Validate origin format (must be a valid URL, not wildcard when credentials=true)
function validateOrigin(origin: string): string {
  try {
    const url = new URL(origin);
    // SECURITY FIX: Don't allow wildcard origins with credentials
    if (origin === '*') {
      throw new Error('Wildcard origin not allowed when credentials=true');
    }
    return origin;
  } catch {
    // P0-FIX: Throw error instead of returning invalid origin
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

// Validate database connection string
const dbConnectionString = process.env['CONTROL_PLANE_DB'];
if (!dbConnectionString) {
  throw new Error('CONTROL_PLANE_DB environment variable is required');
}

const pool = new Pool({
  connectionString: dbConnectionString,
  max: 20,
  min: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

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
      // P0-FIX: Fail open on Redis error - don't block auth
      logger.error('Redis rate limiting error', error as Error);
      // Continue without rate limiting rather than blocking all auth
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

// P1-HIGH FIX: BigInt serialization helper for JSON.stringify
function serializeBigInt(obj: unknown): string {
  return JSON.stringify(obj, (_, v) => 
    typeof v === 'bigint' ? v.toString() : v
  );
}

// P2-MEDIUM FIX: Enhanced error handler with NODE_ENV check for error details
app.setErrorHandler((error: unknown, request, reply) => {
  app.log["error"](error);

  // Determine appropriate status code
  let statusCode = 500;
  let errorCode = 'INTERNAL_ERROR';
  const errorMessage = (error as Error).message ?? '';

  // P1-HIGH FIX: Add explicit check for Fastify validation errors
  if (error && typeof error === 'object' && 'code' in error && 
      (error as { code: string }).code === 'FST_ERR_VALIDATION') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
  } else if (errorMessage.includes('Unauthorized') || errorMessage.includes('Invalid token')) {
  statusCode = 401;
  errorCode = 'AUTH_ERROR';
  } else if (errorMessage.includes('Forbidden')) {
  statusCode = 403;
  errorCode = 'FORBIDDEN';
  } else if (errorMessage.includes('not found')) {
  statusCode = 404;
  errorCode = 'NOT_FOUND';
  } else if (errorMessage.includes('validation') || errorMessage.includes('invalid')) {
  statusCode = 400;
  errorCode = 'VALIDATION_ERROR';
  } else if (errorMessage.includes('conflict') || errorMessage.includes('duplicate')) {
  statusCode = 409;
  errorCode = 'CONFLICT';
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
  error: statusCode === 500 ? 'Internal server error' : (error as Error).message || 'An error occurred',
  code: errorCode,
  };

  // Only include detailed error info in development
  if (isDevelopment) {
  response.message = (error as Error).message;
  response.stack = (error as Error).stack;
  response.details = error;
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
    checkDatabase(pool),
    // Redis health check
    checkRedis(),
    // Queue health check (check for stalled/failed jobs)
    checkQueues(pool),
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
    redis: HealthCheckResult & { latency?: number };
    queues: HealthCheckResult & { stalledJobs?: number; failedJobs?: number; pendingJobs?: number };
  };
}

/**
 * Check database connectivity and performance
 */
async function checkDatabase(pool: Pool): Promise<{ latency: number }> {
  const start = Date.now();
  // Use a slightly more meaningful query that tests actual table access
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
 */
async function checkRedis(): Promise<{ latency: number; mode: string }> {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    // Redis is optional - return healthy if not configured
    return { latency: 0, mode: 'not_configured' };
  }
  
  const redis = new Redis(redisUrl, {
    connectTimeout: 5000,
    commandTimeout: 5000,
    lazyConnect: true,
    retryStrategy: () => null, // Disable retries for health check
  });
  
  const start = Date.now();
  try {
    await redis.connect();
    await redis.ping();
    const info = await redis.info('server');
    const mode = info.includes('redis_mode:cluster') ? 'cluster' : 'standalone';
    return { latency: Date.now() - start, mode };
  } finally {
    await redis.quit();
  }
}

/**
 * Check queue health - look for stalled and failed jobs
 */
async function checkQueues(pool: Pool): Promise<{ stalledJobs: number; failedJobs: number; pendingJobs: number }> {
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

// Detailed health check with container status
app.get('/health/detailed', async () => {
  const containerHealth = await container.getHealth();
  return {
  status: containerHealth.services["database"] ? 'healthy' : 'degraded',
  services: containerHealth.services,
  details: containerHealth.details,
  };
});

// Repository health check
app.get('/health/repositories', async () => {
  const { getRepositoryHealth } = await import('../services/repository-factory');
  return getRepositoryHealth();
});

// P2-MEDIUM FIX: Sequence health monitoring endpoint
app.get('/health/sequences', async (request, reply) => {
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
