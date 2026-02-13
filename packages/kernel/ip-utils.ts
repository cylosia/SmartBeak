/**
 * IP Extraction and Validation Utilities
 * Consolidated from control-plane/services/rate-limit.ts, apps/api/src/utils/rateLimit.ts,
 * and apps/api/src/middleware/rateLimiter.ts.
 */

const IP_VALIDATION_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_VALIDATION_REGEX = /^([0-9a-fA-F]{0,4}:){2,7}[0-9a-fA-F]{0,4}$/;

/**
 * Validate IP address format (IPv4 or IPv6)
 * @param ip - IP address string to validate
 * @returns Whether the string is a valid IP address
 */
export function isValidIp(ip: string): boolean {
  return IP_VALIDATION_REGEX.test(ip) || IPV6_VALIDATION_REGEX.test(ip);
}

/**
 * Extract client IP from a request object, with trusted proxy support.
 * Only trusts X-Forwarded-For when the direct connection IP is from a trusted proxy.
 *
 * @param req - Request-like object with headers and optional ip/socket
 * @param trustedProxies - List of trusted proxy IPs (defaults to TRUSTED_PROXIES env var)
 * @returns Client IP address or 'unknown'
 */
export function getClientIp(
  req: {
    headers: Record<string, string | string[] | undefined>;
    socket?: { remoteAddress?: string };
    ip?: string;
  },
  trustedProxies?: string[]
): string {
  const proxies = trustedProxies ?? (process.env['TRUSTED_PROXIES']?.split(',').map(p => p.trim()) || []);
  const requestIp = req.ip || req.socket?.remoteAddress;

  // Parse X-Forwarded-For header only if request comes from a trusted proxy
  const forwardedFor = req.headers['x-forwarded-for'];
  if (typeof forwardedFor === 'string' && forwardedFor && requestIp) {
    if (proxies.length > 0 && proxies.includes(requestIp)) {
      // Take the leftmost (original client) IP from the chain
      const ips = forwardedFor.split(',').map(ip => ip.trim());
      const clientIp = ips[0];
      if (clientIp && isValidIp(clientIp)) {
        return clientIp;
      }
    }
  }

  // Fallback to direct connection IP
  return requestIp || 'unknown';
}
