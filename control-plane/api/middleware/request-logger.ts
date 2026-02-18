import { FastifyRequest, FastifyReply } from 'fastify';

import { getLogger } from '@kernel/logger';
import { runWithContext, createRequestContext } from '@kernel/request-context';

import { AuthContext } from '../../services/auth';

import crypto from 'crypto';


/**

* Adds structured request logging for API routes
*/

export type AuthenticatedRequest = FastifyRequest & {
  auth?: AuthContext | undefined;
};

export interface RequestLog {
  timestamp: string;
  method: string;
  url: string;
  path: string;
  query: Record<string, unknown>;
  headers: {
  'user-agent'?: string | undefined;
  'content-type'?: string | undefined;
  'x-request-id'?: string | undefined;
  };
  ip: string;
  userId?: string | undefined;
  orgId?: string | undefined;
  duration: number;
  statusCode: number;
  error?: string | undefined;
}

/**
* Generate request ID if not present
*/
function generateRequestId(): string {
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * Validate and sanitize a client-supplied X-Request-ID header value.
 *
 * An attacker can send arbitrary bytes in X-Request-ID to inject newlines
 * into structured log entries (log-injection), poison distributed-trace
 * correlation IDs in SIEM systems, or forge audit-trail entries by spoofing
 * a known request ID. Only accept UUIDs or bounded alphanumeric-dash strings;
 * anything else is discarded and a fresh server-generated ID is used instead.
 */
const SAFE_REQUEST_ID_RE = /^[a-zA-Z0-9_\-]{1,128}$/;
function sanitizeRequestId(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  return SAFE_REQUEST_ID_RE.test(raw) ? raw : undefined;
}

/**
* Get client IP from request.
*
* X-Forwarded-For format: "client, proxy1, proxy2"
* The FIRST element is the originating client IP (added by the first proxy).
* The LAST element is the most-recent proxy's own IP — not the client.
* Previous code returned ips[ips.length - 1] (the proxy IP), which caused logs
* to record the proxy address and defeated IP-based auditing/attribution.
*/
function getClientIP(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
  const ips = forwarded.split(',').map(s => s.trim()).filter(Boolean);
  return ips[0] || req.ip;
  }
  return req.ip;
}

/**
* Request logging middleware for Fastify
*/
export async function requestLoggerMiddleware(
  req: FastifyRequest,
  res: FastifyReply
) {
  const startTime = Date.now();
  const requestId = sanitizeRequestId(req.headers['x-request-id'] as string | undefined) ?? generateRequestId();
  const auth = (req as AuthenticatedRequest).auth;

  const requestContext = createRequestContext({
  userId: auth?.userId,
  // P2-FIX: AuthContext.orgId is a concrete typed property, not an index-
  // signature access. Use dot notation per the codebase conventions.
  orgId: auth?.orgId,
  path: req.routeOptions.url || req.url,
  method: req.method,
  });

  // Run within request context
  await runWithContext(requestContext, async () => {
  const logger = getLogger({
    service: 'api',
    correlationId: requestId,
    context: {
    userId: auth?.userId,
    orgId: auth?.orgId,
    }
  });

  // Add request ID to response headers
  void res.header('X-Request-ID', requestId);

  // Expose trace ID for client-side correlation (bridged from OTel)
  if (requestContext.traceId) {
    void res.header('X-Trace-ID', requestContext.traceId);
  }

  // P2-MEDIUM FIX: Properly clean up event listeners to prevent memory leak
  const cleanup = () => {
    res.raw.removeListener('finish', onFinish);
    res.raw.removeListener('close', onClose);
  };

  const onFinish = () => {
    const duration = Date.now() - startTime;

    // Sanitize query params before logging - remove sensitive data
    const sanitizedQuery = sanitizeQueryParams(req.query as Record<string, unknown>);

    // Redact sensitive headers
    const safeHeaders = redactSensitiveHeaders(req.headers);

    const logEntry: RequestLog = {
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    path: req.routeOptions.url || req.url,
    query: sanitizedQuery,
    headers: {
    'user-agent': safeHeaders['user-agent'],
    // P2-FIX: Remove the unsafe `as string` cast. redactSensitiveHeaders()
    // returns Record<string, string | undefined>. The RequestLog interface
    // already accepts `content-type?: string | undefined` so no cast is needed.
    'content-type': safeHeaders['content-type'],
    'x-request-id': requestId,
    },
    ip: getClientIP(req),
    userId: auth?.userId,
    orgId: auth?.orgId,
    statusCode: res.statusCode,
    duration,
    };

    if (res.statusCode >= 400) {
    // P2-FIX: Use dot notation on concrete typed properties (RequestLog.error
    // and Logger.error). Bracket notation is only required for index-signature
    // types, not for explicitly declared object properties or class methods.
    logEntry.error = `HTTP ${res.statusCode}`;
    logger.error('API request error', undefined, {
    statusCode: res.statusCode,
    method: req.method,
    path: req.routeOptions.url || req.url,
    query: sanitizedQuery,
    });
    } else {
    logger.info('API request', {
    statusCode: res.statusCode,
    method: req.method,
    path: req.routeOptions.url || req.url,
    });
    }

    cleanup();
  };

  const onClose = () => {
    logger.warn('Request connection closed prematurely', {
      method: req.method,
      path: req.routeOptions.url || req.url,
      requestId,
    });
    cleanup();
  };

  res.raw.once('finish', onFinish);
  res.raw.once('close', onClose);
  });
}

/**
* Sanitize query parameters for logging
* Removes sensitive fields like passwords, tokens, keys
*/
// P2-FIX: Replace any with unknown to satisfy the no-explicit-any ESLint rule.
function sanitizeQueryParams(query: Record<string, unknown>): Record<string, unknown> {
  if (!query || typeof query !== 'object') {
  return {};
  }

  const sensitiveFields = ['password', 'token', 'api_key', 'apiKey', 'secret', 'authorization', 'auth'];
  const sanitized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(query)) {
  if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
    sanitized[key] = '[REDACTED]';
  } else {
    sanitized[key] = value;
  }
  }

  return sanitized;
}

/**
* Redact sensitive headers from logs
*/
function redactSensitiveHeaders(headers: FastifyRequest['headers']): Record<string, string | undefined> {
  const sensitiveHeaders = ['authorization', 'cookie', 'x-api-key', 'x-auth-token'];
  const sanitized: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(headers)) {
  if (sensitiveHeaders.includes(key.toLowerCase())) {
    sanitized[key] = '[REDACTED]';
  } else {
    sanitized[key] = value as string | undefined;
  }
  }

  return sanitized;
}

/**
* Simple request logger for route handlers
*/
export function logRequest(
  req: FastifyRequest,
  action: string,
  metadata?: Record<string, unknown>
) {
  const auth = (req as AuthenticatedRequest).auth;
  const requestId = sanitizeRequestId(req.headers['x-request-id'] as string | undefined);

  // Sanitize metadata if provided
  const safeMetadata = metadata ? sanitizeQueryParams(metadata) : undefined;

  const logger = getLogger({
  service: 'api',
  correlationId: requestId,
  context: {
    userId: auth?.userId,
    orgId: auth?.orgId,
  },
  });

  logger.info(action, {
  method: req.method,
  path: req.routeOptions.url,
  ...safeMetadata,
  });
}
