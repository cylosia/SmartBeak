import { FastifyRequest, FastifyReply } from 'fastify';

import { getLogger } from '@kernel/logger';
import { runWithContext, createRequestContext } from '@kernel/request-context';

import { AuthContext } from '../../services/auth';

﻿import crypto from 'crypto';


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
* Get client IP from request
*/
function getClientIP(req: FastifyRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
  const ips = forwarded.split(',').map(s => s.trim()).filter(Boolean);
  return ips[ips.length - 1] || req.ip;
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
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  const auth = (req as AuthenticatedRequest).auth;

  const requestContext = createRequestContext({
  userId: auth?.userId,
  orgId: auth?.["orgId"],
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
    orgId: auth?.["orgId"],
    }
  });

  // Add request ID to response headers
  res.header('X-Request-ID', requestId);

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
    'content-type': safeHeaders['content-type'] as string,
    'x-request-id': requestId,
    },
    ip: getClientIP(req),
    userId: auth?.userId,
    orgId: auth?.["orgId"],
    statusCode: res.statusCode,
    duration,
    };

    if (res.statusCode >= 400) {
    logEntry["error"] = `HTTP ${res.statusCode}`;
    logger["error"]('API request error', undefined, {
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
function sanitizeQueryParams(query: Record<string, any>): Record<string, any> {
  if (!query || typeof query !== 'object') {
  return {};
  }

  const sensitiveFields = ['password', 'token', 'api_key', 'apiKey', 'secret', 'authorization', 'auth'];
  const sanitized: Record<string, any> = {};

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
  const requestId = (req.headers['x-request-id'] as string);

  // Sanitize metadata if provided
  const safeMetadata = metadata ? sanitizeQueryParams(metadata) : undefined;

  const logger = getLogger({
  service: 'api',
  correlationId: requestId,
  context: {
    userId: auth?.userId,
    orgId: auth?.["orgId"],
  },
  });

  logger.info(action, {
  method: req.method,
  path: req.routeOptions.url,
  ...safeMetadata,
  });
}
