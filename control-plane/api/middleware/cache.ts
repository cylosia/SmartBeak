import { FastifyRequest, FastifyReply } from 'fastify';

import crypto from 'crypto';

/**
* Adds HTTP caching support with ETag generation
*/

/**
* Generate ETag for content
* SECURITY FIX: Use SHA-256 instead of MD5 for ETag generation
*/
export function generateETag(content: string | object): string {
  const data = typeof content === 'string' ? content : JSON.stringify(content);
  return `W/'${crypto.createHash('sha256').update(data).digest('hex').substring(0, 16)}'`;
}

/**
* Check if client has matching ETag (If-None-Match header)
*/
export function isETagMatch(req: FastifyRequest, etag: string): boolean {
  const ifNoneMatch = req.headers['if-none-match'];
  if (!ifNoneMatch) return false;

  // Handle weak comparison (W/ prefix)
  const clientETag = ifNoneMatch.toString().replace(/^W\//, '');
  const serverETag = etag.replace(/^W\//, '');
  return clientETag === serverETag;
}

/**
* Set cache headers with ETag
*/
export function setCacheHeaders(
  res: FastifyReply,
  options: {
  etag?: string;
  maxAge?: number | undefined; // seconds
  staleWhileRevalidate?: number | undefined; // seconds
  private?: boolean;
  noCache?: boolean;
  }
) {
  if (options.noCache) {
  void res.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  void res.header('Pragma', 'no-cache');
  void res.header('Expires', '0');
  return;
  }

  if (options.etag) {
  void res.header('ETag', options.etag);
  }

  const directives: string[] = [];
  if (options.private) {
  directives.push('private');
  } else {
  directives.push('public');
  }

  if (options.maxAge !== undefined) {
  directives.push(`max-age=${options.maxAge}`);
  }

  if (options.staleWhileRevalidate !== undefined) {
  directives.push(`stale-while-revalidate=${options.staleWhileRevalidate}`);
  }

  void res.header('Cache-Control', directives.join(', '));
}

/**
* Middleware for ETag-based caching
* Returns 304 Not Modified if content hasn't changed
*/
export function withETagCache(
  handler: (req: FastifyRequest, res: FastifyReply) => Promise<unknown>,
  options: {
  maxAge?: number;
  generateKey?: (req: FastifyRequest) => string;
  } = {}
) {
  return async (req: FastifyRequest, res: FastifyReply) => {
  const result = await handler(req, res);

  if (result === undefined || res.statusCode >= 400) {
    return result;
  }

  const etag = generateETag(result ?? {});

  // Check if client has fresh content
  if (isETagMatch(req, etag)) {
    // RFC 7232 §4.1: 304 responses MUST include the ETag so the client can
    // update its stored value for future conditional requests.
    void res.header('ETag', etag);
    return res.status(304).send();
  }

  // Send ETag + cache directives on every 2xx response so the client can
  // use the ETag for conditional requests on the next poll.
  setCacheHeaders(res, {
    etag,
    maxAge: options.maxAge,
    private: true, // Default to private for API responses
  });

  return result;
  };
}
