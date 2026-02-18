
// Validate environment variables at startup


import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { getPoolInstance, getConnectionMetrics, getBackpressureMetrics } from '@database/pool';
import { registerShutdownHandler, getIsShuttingDown } from '@shutdown';
import { validateEnv, assertBillingConfig } from '@config';
import { AppError, ErrorCodes, RateLimitError } from '@errors';
import { errors as errHelpers } from '@errors/responses';
import type { Pool } from 'pg';
import { shutdownTelemetry } from '@smartbeak/monitoring';

import { getLogger } from '@kernel/logger';
import { BASE_SECURITY_HEADERS, CSP_API, PERMISSIONS_POLICY_API } from '@config/headers';

// P2-PERF-FIX: Moved dynamic imports to top-level. Previously these were
// await import() inside route handlers, making the first request to each endpoint slow.
import { getRepositoryHealth } from '../services/repository-factory';
import { checkSequenceHealth } from '@database/health';
import { authFromHeader, requireRole, type AuthContext } from '../services/auth';
import { initializeContainer } from '../services/container';
import { initializeRateLimiter } from '../services/rate-limit';
import { getRedis } from '@kernel/redis';
import { v1Routes } from './plugins/v1-routes';

try {
  validateEnv();
} catch (error) {
  // Logger not available yet at this point - stderr is acceptable for startup failure
  process.stderr.write(`[startup] Environment validation failed: ${error instanceof Error ? error.message : error}\n`);
  process.exit(1);
}

try {
  assertBillingConfig();
} catch (error) {
  process.stderr.write(`[startup] Billing config validation failed: ${error instanceof Error ? error.message : error}\n`);
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
  // P1-FIX: Trust the first X-Forwarded-For hop from the ingress/load balancer.
  // Without this, req.ip resolves to the load balancer's internal IP, causing:
  // 1. Auth rate limiting to apply to the entire user base as a single bucket
  //    (5 failed auth attempts from one attacker locks out ALL users for 15 min)
  // 2. Any IP-based access control to be trivially bypassed
  trustProxy: true,
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
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Requested-With', 'X-Request-ID', 'traceparent', 'tracestate'],
  exposedHeaders: ['X-Request-ID', 'X-Trace-ID'],
});

// OpenAPI documentation via @fastify/swagger.
// Zod schemas on route definitions are auto-converted to JSON Schema.
app.setValidatorCompiler(validatorCompiler);
app.setSerializerCompiler(serializerCompiler);

await app.register(swagger, {
  openapi: {
    openapi: '3.1.0',
    info: {
      title: 'SmartBeak Control Plane API',
      version: '1.0.0',
      description: 'API for managing content, domains, billing, publishing, and more.',
      contact: {
        name: 'SmartBeak Engineering',
      },
      license: {
        name: 'Proprietary',
      },
    },
    servers: [{ url: '/v1', description: 'API v1' }],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Health', description: 'Service health and readiness endpoints' },
    ],
  },
});

// P2-FIX: Only expose Swagger UI in non-production environments.
// In production the full API contract (all endpoint paths, schemas, security
// schemes, billing structures) is served unauthenticated at /docs, giving
// attackers a complete map for targeted exploitation.
if (process.env['NODE_ENV'] !== 'production') {
  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list' },
  });
}

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
      req.raw.url = `/v1${req.url}`;
    } else {
      // 308 Permanent Redirect: preserves HTTP method (unlike 301 which changes POST to GET)
      const query = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
      return reply.redirect(`/v1${pathname}${query}`, 308);
    }
  });
}

// SECURITY FIX: Add security headers (HSTS, CSP, Cross-Origin, etc.)
// Values sourced from packages/config/headers.ts (canonical source of truth)
app.addHook('onSend', async (request, reply, payload) => {
  // Apply baseline security headers (HSTS, X-Frame-Options, X-Content-Type-Options, etc.)
  for (const [key, value] of Object.entries(BASE_SECURITY_HEADERS)) {
    void reply.header(key, value);
  }

  // Content Security Policy — maximally restrictive for JSON-only API
  void reply.header('Content-Security-Policy', CSP_API);

  // Permissions Policy — fully restrictive (no payment needed for API)
  void reply.header('Permissions-Policy', PERMISSIONS_POLICY_API);

  // Prevent caching of sensitive authenticated responses
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
  void reply.header('Cache-Control', 'private, no-cache, no-store, must-revalidate');
  void reply.header('Pragma', 'no-cache');
  void reply.header('Expires', '0');
  }

  return payload;
});

// H9-FIX: Reject mutating requests that don't declare application/json.
// Prevents content-type confusion where parsers silently receive unexpected formats.
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH']);

app.addHook('preValidation', async (request, reply) => {
  if (!MUTATING_METHODS.has(request.method)) return;

  // Skip requests with no body (e.g. no Content-Length and no Transfer-Encoding)
  const contentLength = request.headers['content-length'];
  const transferEncoding = request.headers['transfer-encoding'];
  if (!contentLength && !transferEncoding) return;

  const contentType = request.headers['content-type'] ?? '';
  if (!contentType.startsWith('application/json')) {
    const requestId = (request.headers['x-request-id'] as string) || '';
    return reply.status(415).send({
      error: 'Unsupported Media Type: Content-Type must be application/json',
      code: ErrorCodes.UNSUPPORTED_MEDIA_TYPE,
      requestId,
    });
  }
});

// P1-FIX: Rate-limit probe endpoints (/health, /readyz, /livez).
// These are unauthenticated and each triggers real DB/Redis queries. Without a
// rate limit, any unauthenticated client can flood them to exhaust the DB pool
// and cause 503s for legitimate traffic — no auth required for the attack.
// Limit: 60 requests per minute per IP (1 req/s — sufficient for any K8s prober).
const PROBE_RATE_LIMIT_WINDOW_MS = 60_000;
const PROBE_RATE_LIMIT_MAX = 60;
const probeRateLimitMap = new Map<string, { count: number; resetAt: number }>();

app.addHook('onRequest', async (request, reply) => {
  const url = request.url ?? '';
  const isProbe = url === '/health' || url.startsWith('/health/') ||
                  url === '/readyz' || url === '/livez';
  if (!isProbe) return;

  const ip = request.ip || 'unknown';
  const now = Date.now();
  const entry = probeRateLimitMap.get(ip);

  if (!entry || now >= entry.resetAt) {
    probeRateLimitMap.set(ip, { count: 1, resetAt: now + PROBE_RATE_LIMIT_WINDOW_MS });
    return;
  }

  entry.count++;
  if (entry.count > PROBE_RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return reply
      .status(429)
      .header('Retry-After', String(retryAfter))
      .send({ error: 'Too Many Requests', retryAfter });
  }
});

// Backpressure hook: reject requests early when DB pool is critically loaded
app.addHook('onRequest', async (request, reply) => {
  // Skip health check endpoints
  if (request.url?.startsWith('/health') || request.url === '/readyz' || request.url === '/livez') return;

  const metrics = getConnectionMetrics();
  const backpressure = getBackpressureMetrics();

  // Reject if pool utilization is critical or too many waiters
  const totalConns = metrics.totalConnections;
  const activeConns = totalConns - metrics.idleConnections;
  const utilization = totalConns > 0 ? activeConns / totalConns : 0;

  if (utilization > 0.9 || metrics.waitingClients > 8 || backpressure.waiting > 8) {
    logger.warn('Backpressure: rejecting request due to pool pressure', {
      waiting: metrics.waitingClients,
      active: activeConns,
      total: totalConns,
      semaphoreWaiting: backpressure.waiting,
      semaphoreAvailable: backpressure.available,
    });
    return reply.status(503).send({
      error: 'Service temporarily unavailable',
      message: 'Server under heavy load. Please retry shortly.',
      retryAfter: 5,
    });
  }
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
  '/v1/login', '/v1/signin', '/v1/signup', '/v1/password-reset',
  '/v1/auth/login', '/v1/auth/signin', '/v1/auth/signup', '/v1/auth/password-reset',
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
        return errHelpers.rateLimited(reply, ttl > 0 ? ttl : windowSeconds, 'Too many authentication attempts. Please try again later.');
      }
    } catch (error) {
      // P0-FIX #1: Fail CLOSED on Redis error for auth endpoints.
      // Auth rate limiting is a security-critical control. If Redis is unavailable,
      // we must deny auth attempts rather than allow unlimited brute-force.
      // This matches the fail-closed policy in rateLimiter.ts middleware.
      logger.error('Redis rate limiting error - denying auth request (fail-closed)', error as Error);
      // H7-FIX: 503 Service Unavailable — the guard is offline, not a quota hit.
      return errHelpers.serviceUnavailable(reply, 'Rate limiting service unavailable. Please try again later.');
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
      return errHelpers.unauthorized(reply);
    }

    (req as { auth: unknown }).auth = await authFromHeader(authHeader);
  } catch (error: unknown) {
    // P2-SECURITY-FIX: Return generic 'Unauthorized' message instead of forwarding
    // authFromHeader error details. Previously, JWT library internals like
    // "Token verification failed: invalid algorithm" were sent to the client,
    // leaking implementation details useful for targeted attacks.
    // The specific error is already logged server-side via the logger.
    logger.warn('Auth middleware rejected request', { error: error instanceof Error ? error.message : String(error) });
    return errHelpers.unauthorized(reply, 'Unauthorized');
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

// Global error handler — produces the canonical ErrorResponse shape for all errors.
// Shape: { error, code, requestId, details?, retryAfter? }
app.setErrorHandler((error: unknown, request, reply) => {
  const requestId = (request.headers['x-request-id'] as string) || '';
  app.log["error"](error);

  // 1. AppError subclasses carry their own code + statusCode
  if (error instanceof AppError) {
    const isDev = process.env['NODE_ENV'] === 'development';
    const body: Record<string, unknown> = {
      error: error.message,
      code: error.code,
      requestId,
    };
    if (isDev && error.details !== undefined) {
      body['details'] = error.details;
    }
    if (error instanceof RateLimitError) {
      body['retryAfter'] = error.retryAfter;
      void reply.header('Retry-After', String(error.retryAfter));
    }
    void reply.status(error.statusCode).send(body);
    return;
  }

  // 2. Fastify validation errors + generic errors with statusCode
  const errObj = error as { statusCode?: number; code?: string; message?: string; validation?: unknown };
  let statusCode = errObj.statusCode ?? 500;
  let errorCode: string = ErrorCodes.INTERNAL_ERROR;

  if (errObj.code === 'FST_ERR_VALIDATION') {
    statusCode = 400;
    errorCode = ErrorCodes.VALIDATION_ERROR;
  } else if (statusCode === 401) {
    errorCode = ErrorCodes.AUTH_ERROR;
  } else if (statusCode === 403) {
    errorCode = ErrorCodes.FORBIDDEN;
  } else if (statusCode === 404) {
    errorCode = ErrorCodes.NOT_FOUND;
  } else if (statusCode === 400) {
    errorCode = ErrorCodes.VALIDATION_ERROR;
  } else if (statusCode === 402) {
    errorCode = 'BUDGET_EXCEEDED';
  } else if (statusCode === 409) {
    errorCode = ErrorCodes.CONFLICT;
  } else if (statusCode === 429) {
    errorCode = ErrorCodes.RATE_LIMIT_EXCEEDED;
  }

  const isDevelopment = process.env['NODE_ENV'] === 'development';
  const body: Record<string, unknown> = {
    error: statusCode === 500 ? 'Internal server error' : (errObj.message || 'An error occurred'),
    code: errorCode,
    requestId,
  };

  if (isDevelopment && errObj.message) {
    body['details'] = { message: errObj.message };
  }

  void reply.status(statusCode).send(body);
});

// 404 handler — canonical shape
app.setNotFoundHandler((request, reply) => {
  const requestId = (request.headers['x-request-id'] as string) || '';
  void reply.status(404).send({ error: 'Route not found', code: ErrorCodes.NOT_FOUND, requestId });
});

// Register all routes — business routes under /v1 prefix, infra routes at root
async function registerRoutes(): Promise<void> {
  // Make container available to routes via app decorator.
  // Parent decorators are visible inside encapsulated child contexts.
  app.decorate('container', container);

  // All business routes registered under /v1 prefix via Fastify plugin encapsulation.
  // Individual route modules are unchanged — the prefix is applied automatically.
  await app.register(v1Routes, { prefix: '/v1', pool });
}

// P1-CRITICAL FIX: Deep health check with comprehensive dependency verification
app.get('/health', {
  schema: {
    operationId: 'getHealth',
    summary: 'Basic health check',
    description: 'Returns overall service health status. Public endpoint used by load balancers.',
    tags: ['Health'],
    response: {
      200: { type: 'object', properties: { status: { type: 'string' }, timestamp: { type: 'string' } } },
      503: { type: 'object', properties: { status: { type: 'string' }, timestamp: { type: 'string' } } },
    },
  },
}, async (request, reply) => {
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
app.get('/readyz', {
  schema: {
    operationId: 'getReadiness',
    summary: 'Kubernetes readiness probe',
    description: 'Checks if the pod should receive traffic. Returns 503 during graceful shutdown or when critical dependencies are unreachable.',
    tags: ['Health'],
    response: {
      200: { type: 'object', properties: { ready: { type: 'boolean' }, timestamp: { type: 'string' } } },
      503: { type: 'object', properties: { ready: { type: 'boolean' }, timestamp: { type: 'string' } } },
    },
  },
}, async (_request, reply) => {
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

app.get('/livez', {
  schema: {
    operationId: 'getLiveness',
    summary: 'Kubernetes liveness probe',
    description: 'Checks if the process is stuck or deadlocked by measuring event loop responsiveness.',
    tags: ['Health'],
    response: {
      200: { type: 'object', properties: { alive: { type: 'boolean' }, timestamp: { type: 'string' } } },
      503: { type: 'object', properties: { alive: { type: 'boolean' }, timestamp: { type: 'string' } } },
    },
  },
}, async (_request, reply) => {
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
app.get('/health/detailed', {
  schema: {
    operationId: 'getHealthDetailed',
    summary: 'Detailed health check (admin)',
    description: 'Returns detailed infrastructure health including service states. Requires admin or owner role.',
    tags: ['Health'],
    response: {
      200: { type: 'object', properties: { status: { type: 'string' }, services: { type: 'object' }, details: { type: 'object' } } },
      401: { type: 'object', properties: { error: { type: 'string' } } },
      403: { type: 'object', properties: { error: { type: 'string' } } },
    },
  },
}, async (request, reply) => {
  const auth = (request as { auth?: AuthContext | null }).auth;
  if (!auth) {
    return errHelpers.unauthorized(reply, 'Authentication required for detailed health checks');
  }
  // P0-AUDIT-FIX: Require admin/owner role — previously any authenticated user could access
  try { requireRole(auth, ['admin', 'owner']); } catch { return errHelpers.forbidden(reply, 'Admin access required'); }
  if (!container) throw new Error('Container not initialized');
  const containerHealth = await container.getHealth();
  return {
  status: containerHealth.services["database"] ? 'healthy' : 'degraded',
  services: containerHealth.services,
  details: containerHealth.details,
  };
});

// F33-FIX: Require auth for repository health check
app.get('/health/repositories', {
  schema: {
    operationId: 'getHealthRepositories',
    summary: 'Repository health check (admin)',
    description: 'Returns repository-specific health information. Requires admin or owner role.',
    tags: ['Health'],
    response: {
      200: { type: 'object', properties: { healthy: { type: 'boolean' } } },
      401: { type: 'object', properties: { error: { type: 'string' } } },
      403: { type: 'object', properties: { error: { type: 'string' } } },
    },
  },
}, async (request, reply) => {
  const auth = (request as { auth?: AuthContext | null }).auth;
  if (!auth) {
    return errHelpers.unauthorized(reply);
  }
  // P0-AUDIT-FIX: Require admin/owner role
  try { requireRole(auth, ['admin', 'owner']); } catch { return errHelpers.forbidden(reply, 'Admin access required'); }
  return getRepositoryHealth();
});

// F33-FIX: Require auth for sequence health monitoring
app.get('/health/sequences', {
  schema: {
    operationId: 'getHealthSequences',
    summary: 'Sequence health check (admin)',
    description: 'Returns database sequence health data. Requires admin or owner role.',
    tags: ['Health'],
    response: {
      200: { type: 'object', properties: { healthy: { type: 'boolean' }, sequences: { type: 'object' }, checkedAt: { type: 'string' } } },
      401: { type: 'object', properties: { error: { type: 'string' } } },
      403: { type: 'object', properties: { error: { type: 'string' } } },
      503: { type: 'object', properties: { healthy: { type: 'boolean' }, sequences: { type: 'object' }, checkedAt: { type: 'string' } } },
    },
  },
}, async (request, reply) => {
  const auth = (request as { auth?: AuthContext | null }).auth;
  if (!auth) {
    return errHelpers.unauthorized(reply);
  }
  // P0-AUDIT-FIX: Require admin/owner role
  try { requireRole(auth, ['admin', 'owner']); } catch { return errHelpers.forbidden(reply, 'Admin access required'); }
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

  // Load cost tracking budgets from database
  try {
    await container.costTracker.loadBudgetsFromDb();
    logger.info('Cost tracking budgets loaded');
  } catch (error) {
    logger.warn('Failed to load cost tracking budgets, spending limits may not be enforced', {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  // Flush cost tracking buffer on shutdown
  registerShutdownHandler(async () => {
    container.costTracker.stop();
    logger.info('Cost tracker stopped and buffer flushed');
  });

  await registerRoutes();
  // P3-FIX: Validate port is an integer in the unprivileged range [1024, 65535].
  // Number(process.env['PORT']) returns 0 for empty strings (falsy, falls back to 3000),
  // but parseInt with no validation accepts port 80 (requires root on Linux) silently.
  const rawPort = parseInt(process.env['PORT'] ?? '', 10);
  const port = (Number.isInteger(rawPort) && rawPort >= 1024 && rawPort <= 65535) ? rawPort : 3000;
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

  // Flush pending OTel spans before process exit
  registerShutdownHandler(async () => {
    logger.info('Flushing telemetry spans...');
    await shutdownTelemetry();
    logger.info('Telemetry shutdown complete');
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
