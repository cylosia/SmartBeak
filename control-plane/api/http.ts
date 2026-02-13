
// Validate environment variables at startup


import cors from '@fastify/cors';
import Fastify from 'fastify';
import type { Pool } from 'pg';
import { getPoolInstance } from '@database/pool';
import { registerShutdownHandler, getIsShuttingDown } from '@shutdown';
import { validateEnv } from '@config';

import { getLogger } from '@kernel/logger';

// P2-PERF-FIX: Moved dynamic imports to top-level. Previously these were
// await import() inside route handlers, making the first request to each endpoint slow.
import { getRepositoryHealth } from '../services/repository-factory';
import { checkSequenceHealth } from '@database/health';
import { affiliateRoutes } from './routes/affiliates';
import { analyticsRoutes } from './routes/analytics';
import { attributionRoutes } from './routes/attribution';
import { authFromHeader, requireRole, type AuthContext } from '../services/auth';
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
} catch (error) {
  // Logger not available yet at this point - stderr is acceptable for startup failure
  process.stderr.write(`[startup] Environment validation failed: ${error instanceof Error ? error.message : error}\n`);
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
    const parsed = new URL(origin);
    // P1-SECURITY-FIX: Enforce HTTPS in production to prevent MITM when credentials=true.
    // An http:// origin combined with credentials: true allows session cookies to be
    // transmitted in cleartext, enabling interception by network attackers.
    if (process.env['NODE_ENV'] === 'production' && parsed.protocol !== 'https:') {
      throw new Error('HTTPS origin required in production when credentials=true');
    }
    return origin;
  } catch (err) {
    if (err instanceof Error && err.message.includes('HTTPS origin required')) {
      throw err;
    }
    throw new Error(`Invalid origin format: ${origin}`);
  }
}

const validatedOrigin = validateOrigin(allowedOrigin);

await app.register(cors, {
  origin: validatedOrigin,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  // P2-SECURITY-FIX: Removed X-CSRF-Token from allowedHeaders. It was listed but
  // no CSRF validation middleware exists, creating a false sense of security.
  // For a Bearer-token-only API, CSRF protection is not required.
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With', 'X-Request-ID']
});

// API Versioning: Backward compatibility for unversioned paths.
// Redirects (or rewrites) requests like GET /domains to /v1/domains.
// Health check routes are excluded — they are infrastructure, not API contract.
// Control via API_LEGACY_PATH_MODE env var: 'redirect' (default) | 'rewrite' | 'off'
const LEGACY_PATH_MODE = process.env['API_LEGACY_PATH_MODE'] || 'redirect';

if (LEGACY_PATH_MODE !== 'off') {
  app.addHook('onRequest', async (req, reply) => {
    const pathname = req.url?.split('?')[0] ?? '';

    // Already versioned — pass through
    if (pathname.startsWith('/v1/') || pathname === '/v1') return;

    // Health check routes stay at root — pass through
    if (pathname === '/health' || pathname.startsWith('/health/')) return;

    // Root path — pass through
    if (pathname === '/' || pathname === '') return;

    if (LEGACY_PATH_MODE === 'rewrite') {
      // Silent rewrite: route to /v1 without client roundtrip
      req.url = `/v1${req.url}`;
    } else {
      // 308 Permanent Redirect: preserves HTTP method (unlike 301 which changes POST to GET)
      const query = req.url?.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
      return reply.redirect(308, `/v1${pathname}${query}`);
    }
  });
}

// SECURITY FIX: Add security headers (HSTS, CSP, etc.)
app.addHook('onSend', async (request, reply, payload) => {
  // HSTS - HTTP Strict Transport Security
  void reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');

  // Content Security Policy
  void reply.header('Content-Security-Policy', 'default-src \'self\'; frame-ancestors \'none\';');

  // Prevent clickjacking
  void reply.header('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  void reply.header('X-Content-Type-Options', 'nosniff');

  // XSS Protection
  void reply.header('X-XSS-Protection', '1; mode=block');

  // Referrer Policy
  void reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Permissions Policy
  void reply.header('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');

  // Prevent caching of sensitive authenticated responses
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
  void reply.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  void reply.header('Pragma', 'no-cache');
  void reply.header('Expires', '0');
  }

  return payload;
});

// P0-FIX #7: Use the managed pool from packages/database/pool instead of creating a
// Pool and container are initialized lazily in start() to avoid connecting to the
// database at module import time. Previously, a top-level await here meant that
// any import of this module would block until the database was reachable.
let pool: Pool;
let container: ReturnType<typeof initializeContainer>;

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

// P2-DEAD-CODE-FIX: Removed _inMemoryRateLimit function and inMemoryRateLimitCache (LRU).
// These were dead code: _inMemoryRateLimit was never called, and the Redis catch block (below)
// returns 429 directly (fail-closed). The LRU cache allocated 10k-entry capacity for nothing.
// The fail-closed policy is intentional for auth endpoints (see P0-FIX #1 comment below).

// P0-AUDIT-FIX: Use explicit path set for auth endpoints instead of startsWith/regex.
// Previous startsWith('/auth') matched /authors, /authorization etc.
// Previous regex /(login|signin|signup|password-reset)$/ didn't match URLs with query strings.
const AUTH_ENDPOINT_PATHS = new Set([
  // Versioned paths (canonical)
  '/v1/login', '/v1/signin', '/v1/signup', '/v1/password-reset',
  '/v1/auth/login', '/v1/auth/signin', '/v1/auth/signup', '/v1/auth/password-reset',
  // Legacy unversioned paths (for backward compat during transition)
  '/login', '/signin', '/signup', '/password-reset',
  '/auth/login', '/auth/signin', '/auth/signup', '/auth/password-reset',
]);

app.addHook('onRequest', async (req, reply) => {
  // Check if this is an auth endpoint that needs stricter rate limiting
  // Use pathname (strip query string) for reliable matching
  const pathname = req.url?.split('?')[0] ?? '';
  const isAuthEndpoint = AUTH_ENDPOINT_PATHS.has(pathname);

  if (isAuthEndpoint) {
    const clientIp = req.ip || 'unknown';
    const windowSeconds = Math.ceil(AUTH_RATE_LIMIT_WINDOW / 1000);
    const key = `ratelimit:auth:${clientIp}`;

    try {
      const redis = await getRedis();
      // P0-FIX: Atomic INCR+EXPIRE via Lua script to prevent permanent rate-limiting
      // if process crashes between INCR and EXPIRE (key persists without TTL forever).
      const atomicIncrScript = `
        local current = redis.call('INCR', KEYS[1])
        if current == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
        return current
      `;
      const current = await redis.eval(atomicIncrScript, 1, key, windowSeconds) as number;

      if (current > AUTH_RATE_LIMIT_MAX) {
        const ttl = await redis.ttl(key);
        return reply.status(429).send({
          error: 'Too Many Requests',
          message: 'Too many authentication attempts. Please try again later.',
          retryAfter: ttl > 0 ? ttl : windowSeconds
        });
      }
    } catch (error) {
      // P0-FIX #1: Fail CLOSED on Redis error for auth endpoints.
      // Auth rate limiting is a security-critical control. If Redis is unavailable,
      // we must deny auth attempts rather than allow unlimited brute-force.
      // This matches the fail-closed policy in rateLimiter.ts middleware.
      logger.error('Redis rate limiting error - denying auth request (fail-closed)', error as Error);
      return reply.status(429).send({
        error: 'Too Many Requests',
        message: 'Rate limiting service unavailable. Please try again later.',
        retryAfter: 60
      });
    }
  }

  // P0-FIX: Auth middleware - rejects invalid auth by default (secure-by-default)
  // Previously: set auth = null and continued, relying on route-level checks (bypass vulnerability)
  // Now: rejects requests with invalid auth unless explicitly marked as public
  try {
    const authHeader = req.headers.authorization;

    // Check if route is marked as public (via route config or path pattern)
    // P0-AUDIT-FIX: Use strict path boundary matching. Previous startsWith('/health')
    // matched /healthadmin, /healthy etc. Now requires exact match or path separator.
    // P1-SECURITY-FIX: Removed blanket pathname.startsWith('/webhooks/') exemption.
    // Previously ALL /webhooks/* routes were unauthenticated with no signature verification
    // at the middleware level. Webhook routes must now individually opt into public access
    // via config: { public: true } on the route definition and implement their own
    // signature verification (e.g., Stripe HMAC, Clerk webhook signature).
    const isPublicRoute = (req.routeOptions?.config as { public?: boolean })?.public === true ||
                         pathname === '/health' || pathname.startsWith('/health/') ||
                         pathname === '/readyz' || pathname === '/livez';

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
    // P2-SECURITY-FIX: Return generic 'Unauthorized' message instead of forwarding
    // authFromHeader error details. Previously, JWT library internals like
    // "Token verification failed: invalid algorithm" were sent to the client,
    // leaking implementation details useful for targeted attacks.
    // The specific error is already logged server-side via the logger.
    logger.warn('Auth middleware rejected request', { error: error instanceof Error ? error.message : String(error) });
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Unauthorized'
    });
  }
});

// F9-FIX: Register BigInt serialization as a Fastify preSerialization hook.
// P1-AUDIT-FIX: Replaced double-stringify approach (which serialized every response just to
// detect BigInt, wasting O(n) CPU+memory) with a recursive walk that only triggers the
// replacer path when BigInt values are actually found.
function containsBigInt(obj: unknown, depth: number = 0): boolean {
  if (depth > 20) return false; // Guard against deeply nested objects
  if (typeof obj === 'bigint') return true;
  if (typeof obj !== 'object' || obj === null) return false;
  if (Array.isArray(obj)) return obj.some(item => containsBigInt(item, depth + 1));
  for (const val of Object.values(obj)) {
    if (containsBigInt(val, depth + 1)) return true;
  }
  return false;
}

app.addHook('preSerialization', async (_request, _reply, payload) => {
  if (typeof payload === 'object' && payload !== null && containsBigInt(payload)) {
    const json = JSON.stringify(payload, (_, v) =>
      typeof v === 'bigint' ? v.toString() : v
    );
    return JSON.parse(json);
  }
  return payload;
});

// P2-FIX #19: Enhanced error handler using Fastify's native statusCode property
// instead of fragile string matching on error.message (which misclassifies errors
// whose messages incidentally contain 'not found', 'invalid', etc.)
app.setErrorHandler((error: unknown, request, reply) => {
  app.log["error"](error);

  // Determine appropriate status code - prefer explicit statusCode on the error object
  const errObj = error as { statusCode?: number; code?: string; message?: string };
  let statusCode = errObj.statusCode ?? 500;
  let errorCode = 'INTERNAL_ERROR';

  // Check Fastify validation errors first (they have a code property)
  if (errObj.code === 'FST_ERR_VALIDATION') {
    statusCode = 400;
    errorCode = 'VALIDATION_ERROR';
  } else if (statusCode === 401) {
    errorCode = 'AUTH_ERROR';
  } else if (statusCode === 403) {
    errorCode = 'FORBIDDEN';
  } else if (statusCode === 404) {
    errorCode = 'NOT_FOUND';
  } else if (statusCode === 400) {
    errorCode = 'VALIDATION_ERROR';
  } else if (statusCode === 409) {
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
  error: statusCode === 500 ? 'Internal server error' : (errObj.message || 'An error occurred'),
  code: errorCode,
  };

  // F8-FIX: Only include sanitized error info in development.
  // Previously serialized the full raw error object which could contain
  // DB connection strings, internal paths, or secrets in error messages.
  if (isDevelopment) {
  response.message = errObj.message;
  // Never include raw error objects - they may contain sensitive data
  }

  void reply.status(statusCode).send(response);
});

// 404 handler
app.setNotFoundHandler((request, reply) => {
  void reply.status(404).send({ error: 'Route not found', code: 'NOT_FOUND' });
});

// Register all routes under /v1 prefix using Fastify's encapsulated plugin pattern.
// Parent-level hooks (CORS, auth, security headers, BigInt serialization, error handler)
// automatically propagate to routes registered inside the /v1 plugin.
// Health check routes (registered directly on app below) stay at root.
async function registerRoutes(): Promise<void> {
  // Make container available to routes via app decorator.
  // Parent decorators are visible inside encapsulated child contexts.
  app.decorate('container', container);

  await app.register(async function v1Routes(v1) {
    // Core routes
    await planningRoutes(v1, pool);
    await contentRoutes(v1, pool);
    await domainRoutes(v1, pool);
    await billingRoutes(v1, pool);
    await orgRoutes(v1, pool);
    await onboardingRoutes(v1, pool);
    await notificationRoutes(v1, pool);
    await searchRoutes(v1, pool);
    await usageRoutes(v1, pool);
    await seoRoutes(v1, pool);
    await analyticsRoutes(v1, pool);
    await publishingRoutes(v1, pool);
    await mediaRoutes(v1, pool);
    await queueRoutes(v1, pool);

    // Additional routes
    // C3-FIX: Removed contentListRoutes — it registered a duplicate GET /content that conflicted
    // with contentRoutes above. The content.ts handler is the canonical one.
    await contentRevisionRoutes(v1, pool);
    await contentScheduleRoutes(v1);
    await domainOwnershipRoutes(v1, pool);
    await guardrailRoutes(v1, pool);
    await mediaLifecycleRoutes(v1, pool);
    await notificationAdminRoutes(v1, pool);
    await publishingCreateJobRoutes(v1, pool);
    await publishingPreviewRoutes(v1, pool);
    await queueMetricsRoutes(v1, pool);

    // New routes to fix missing API endpoints
    await affiliateRoutes(v1, pool);
    await diligenceRoutes(v1, pool);
    await attributionRoutes(v1, pool);
    await timelineRoutes(v1, pool);
    await domainDetailsRoutes(v1, pool);
    await themeRoutes(v1, pool);
    await roiRiskRoutes(v1, pool);
    await portfolioRoutes(v1, pool);
    await llmRoutes(v1, pool);
    await billingInvoiceRoutes(v1, pool);

    // Migrated routes from apps/api/src/routes/
    await registerAppsApiRoutes(v1, pool);
  }, { prefix: '/v1' });
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

  // P1-AUDIT-FIX: Public endpoint returns only status — no latencies, modes, or job counts.
  // Detailed data is available at /health/detailed (authenticated, admin-only).
  return reply.status(statusCode).send({
    status: health.status,
    timestamp: health.timestamp,
  });
});

// Kubernetes readiness probe - checks if pod should receive traffic.
// Returns 503 during graceful shutdown or if critical dependencies
// (database, Redis) are unreachable.
app.get('/readyz', async (_request, reply) => {
  // During graceful shutdown, tell K8s to stop routing traffic to this pod.
  // This allows in-flight requests to drain before the process exits.
  if (getIsShuttingDown()) {
    return reply.status(503).send({
      ready: false,
      timestamp: new Date().toISOString(),
    });
  }

  // Check critical dependencies in parallel (reuse existing helpers)
  const checks = await Promise.allSettled([
    checkDatabase(),
    checkRedisHealth(),
  ]);

  const ready = checks.every(c => c.status === 'fulfilled');

  return reply.status(ready ? 200 : 503).send({
    ready,
    timestamp: new Date().toISOString(),
  });
});

// Kubernetes liveness probe - checks if pod is stuck/deadlocked.
// Measures event loop responsiveness. A pod with a down database is NOT
// dead and should not be restarted — only a blocked event loop indicates
// the process is stuck and needs a restart.
const EVENT_LOOP_LAG_THRESHOLD_MS = 5000;

app.get('/livez', async (_request, reply) => {
  // Measure event loop lag: schedule a timer for 0ms and measure actual delay.
  // If the event loop is blocked (e.g., infinite loop, CPU-bound work),
  // the callback fires late, and lagMs will exceed the threshold.
  const lagStart = Date.now();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  const lagMs = Date.now() - lagStart;

  const alive = lagMs < EVENT_LOOP_LAG_THRESHOLD_MS;

  return reply.status(alive ? 200 : 503).send({
    alive,
    timestamp: new Date().toISOString(),
  });
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
  if (!pool) throw new Error('Database pool not initialized');
  const start = Date.now();
  const TIMEOUT_MS = 5000;
  // P0-FIX: Rewritten to fix two bugs in the original Promise.race pattern:
  // 1. Pool connection leak: when timeout won, pool.connect() still resolved later,
  //    returning a PoolClient that was never released (permanent pool exhaustion).
  // 2. Unhandled rejection: when pool.connect() won, the timeout setTimeout still fired
  //    and rejected a promise nobody was listening to (process crash with --unhandled-rejections=throw).
  //
  // Solution: Track the connect promise separately so we can release the client even if
  // the timeout wins the race. The .then() on connectPromise always releases the client
  // when the timeout has already fired.
  let timeoutHandle: NodeJS.Timeout;
  let timedOut = false;

  const connectPromise = pool.connect();
  const connectTimeout = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      reject(new Error('Database connect timeout (5s)'));
    }, TIMEOUT_MS);
  });

  // Ensure orphaned connections are released if timeout fires first
  connectPromise.then(c => {
    if (timedOut) c.release();
  }).catch(() => { /* pool.connect() failure already handled by Promise.race */ });

  try {
    const client = await Promise.race([connectPromise, connectTimeout]);
    clearTimeout(timeoutHandle!);
    try {
      await client.query('SELECT 1');
      return { latency: Date.now() - start };
    } finally {
      client.release();
    }
  } catch (err) {
    clearTimeout(timeoutHandle!);
    throw err;
  }
}

/**
 * Check Redis connectivity and performance
 * P0-FIX #5: Reuse existing Redis connection instead of creating a new one per health check.
 * Previously created a new Redis connection on every /health request, causing connection churn
 * (8,640+ connections/day/pod with 10s probe interval).
 */
async function checkRedisHealth(): Promise<{ latency: number; mode: string }> {
  const redisUrl = process.env['REDIS_URL'];
  if (!redisUrl) {
    // Redis is optional - return healthy if not configured
    return { latency: 0, mode: 'not_configured' };
  }

  const start = Date.now();
  try {
    const redis = await getRedis();
    await redis.ping();
    return { latency: Date.now() - start, mode: 'connected' };
  } catch (error) {
    throw new Error(`Redis health check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Check queue health - look for stalled and failed jobs
 */
async function checkQueues(): Promise<{ stalledJobs: number; failedJobs: number; pendingJobs: number }> {
  if (!pool) throw new Error('Database pool not initialized');
  // P1-FIX: Combined 3 sequential queries into 1 to reduce pool connection usage.
  // Previously consumed 3 pool connections per health check request.
  const result = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'processing' AND updated_at < NOW() - INTERVAL '30 minutes') AS stalled,
       COUNT(*) FILTER (WHERE status = 'failed' AND updated_at > NOW() - INTERVAL '1 hour') AS failed,
       COUNT(*) FILTER (WHERE status IN ('pending', 'scheduled')) AS pending
     FROM publishing_jobs`
  );

  const row = result.rows[0];
  const stalledJobs = parseInt(row?.stalled || '0', 10);
  const failedJobs = parseInt(row?.failed || '0', 10);
  const pendingJobs = parseInt(row?.pending || '0', 10);

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
  const auth = (request as { auth?: AuthContext | null }).auth;
  if (!auth) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required for detailed health checks' });
  }
  // P0-AUDIT-FIX: Require admin/owner role — previously any authenticated user could access
  try { requireRole(auth, ['admin', 'owner']); } catch { return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' }); }
  if (!container) throw new Error('Container not initialized');
  const containerHealth = await container.getHealth();
  return {
  status: containerHealth.services["database"] ? 'healthy' : 'degraded',
  services: containerHealth.services,
  details: containerHealth.details,
  };
});

// F33-FIX: Require auth for repository health check
app.get('/health/repositories', async (request, reply) => {
  const auth = (request as { auth?: AuthContext | null }).auth;
  if (!auth) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
  }
  // P0-AUDIT-FIX: Require admin/owner role
  try { requireRole(auth, ['admin', 'owner']); } catch { return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' }); }
  return getRepositoryHealth();
});

// F33-FIX: Require auth for sequence health monitoring
app.get('/health/sequences', async (request, reply) => {
  const auth = (request as { auth?: AuthContext | null }).auth;
  if (!auth) {
    return reply.status(401).send({ error: 'Unauthorized', message: 'Authentication required' });
  }
  // P0-AUDIT-FIX: Require admin/owner role
  try { requireRole(auth, ['admin', 'owner']); } catch { return reply.status(403).send({ error: 'Forbidden', message: 'Admin access required' }); }
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
  // Initialize database pool (moved from module scope so the module can be
  // imported without requiring a live database connection)
  pool = await getPoolInstance();
  container = initializeContainer({ dbPool: pool });

  await registerRoutes();
  const port = Number(process.env['PORT']) || 3000; // P3-FIX: Use Number() || fallback instead of parseInt to avoid NaN
  await app.listen({ port, host: '0.0.0.0' });
  logger.info(`Server started on port ${port}`);

  // P1-SECURITY-FIX: Register Fastify graceful shutdown handler.
  // Previously, app.close() was never called on SIGTERM/SIGINT. This caused:
  // 1. In-flight requests to receive TCP RST during deployments (502 errors)
  // 2. Database transactions to commit without HTTP response being sent
  // 3. Client-side retries on already-completed operations (double-writes)
  registerShutdownHandler(async () => {
    logger.info('Closing Fastify server (draining connections)...');
    await app.close();
    logger.info('Fastify server closed');
  });
  } catch (error) {
  logger["error"]('Failed to start server', error instanceof Error ? error : new Error(String(error)));
  process.exit(1);
  }
}

void start();

// P2-AUDIT-FIX: Removed pool export — consumers should import from @database/pool
// to ensure connection monitoring, exhaustion alerts, and metrics are active.
export { app };
