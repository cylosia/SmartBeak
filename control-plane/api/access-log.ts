import { FastifyRequest } from 'fastify';
import { getLogger } from '@kernel/logger';

/**
 * P2-MEDIUM FIX: Use structured logger with correlation ID instead of req.server.log
 */
export function logReadAccess(req: FastifyRequest, context: string) {
  const requestId = req.headers['x-request-id'] as string | undefined;
  
  const logger = getLogger({
    service: 'api:access',
    correlationId: requestId,
    context: {
      route: req.routeOptions.url,
      method: req.method,
    }
  });

  logger.info('read_access', {
    context,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    timestamp: new Date().toISOString()
  });
}
