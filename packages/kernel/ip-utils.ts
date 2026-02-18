/**
 * IP Extraction and Validation Utilities
 * Consolidated from control-plane/services/rate-limit.ts, apps/api/src/utils/rateLimit.ts,
 * and apps/api/src/middleware/rateLimiter.ts.
 */

/**
 * Validate IP address format (IPv4 or IPv6)
 * Uses part-by-part validation to avoid ReDoS from nested quantifiers.
 * @param ip - IP address string to validate
 * @returns Whether the string is a valid IP address
 */
export function isValidIp(ip: string): boolean {
  // IPv4: split on '.' and validate each octet
  const v4Parts = ip.split('.');
  if (v4Parts.length === 4) {
    return v4Parts.every(p => {
      // Reject leading zeros (e.g. "007"): they are syntactically ambiguous.
      // Some downstream parsers treat them as octal, allowing an attacker to
      // craft an IP that passes an allowlist check as decimal 7 but is routed
      // as octal 7 (== decimal 7 here, but "010" == 8 decimal vs 10 decimal
      // depending on the parser). Normalise by rejecting any multi-digit
      // component with a leading zero.
      if (p.length > 1 && p.startsWith('0')) return false;
      return /^\d{1,3}$/.test(p) && parseInt(p, 10) <= 255;
    });
  }
  // IPv6: split on ':' and validate each group
  if (ip.includes(':')) {
    const v6Parts = ip.split(':');
    return v6Parts.length >= 3 && v6Parts.length <= 8
      && v6Parts.every(p => /^[0-9a-fA-F]{0,4}$/.test(p));
  }
  return false;
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

  // Fallback to direct connection IP.
  // Validate before returning: framework values like req.ip come from trusted
  // infrastructure, but req.socket.remoteAddress may contain unexpected
  // formats in test environments or unusual proxy setups.
  if (requestIp && isValidIp(requestIp)) {
    return requestIp;
  }
  return 'unknown';
}
