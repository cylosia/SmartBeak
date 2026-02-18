/**
 * SSRF Protection Utility
 * Prevents Server-Side Request Forgery attacks by blocking internal IP addresses
 *
 * P1-HIGH SECURITY FIX: Issue 1 - SSRF vulnerability protection
 */

import { URL } from 'url';
import dns from 'dns/promises';

/**
 * Internal IP patterns to block
 * Covers IPv4 private ranges, loopback, and IPv6 unique local/link-local
 *
 * SS-06-FIX: Added previously-missing ranges:
 *   100.64.0.0/10 — IANA Shared Address Space (carrier-grade NAT / cloud internal)
 *   2002:7f../2002:0a../2002:c0a8.. — 6to4 encapsulation of loopback/private IPv4
 *   64:ff9b::/96 — NAT64 well-known prefix; 64:ff9b::127.0.0.1 tunnels to loopback
 *   ::ffff:<hex> — IPv4-mapped IPv6 hex form not covered by the dotted-decimal regex
 *   fd00:ec2::254 — AWS Nitro IMDSv2 IPv6 endpoint
 */
const INTERNAL_IP_PATTERNS = [
  // IPv4 loopback
  /^127\./,
  /^localhost$/i,
  // IPv4 private ranges
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  // IPv4 link-local (includes AWS IMDS 169.254.169.254)
  /^169\.254\./,
  // IPv4 zero/current network
  /^0\./,
  /^0\.0\.0\.0$/,
  // IPv4 IANA Shared Address Space / carrier-grade NAT (100.64.0.0/10)
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  // IPv6 loopback
  /^::1$/,
  // IPv6 unique local (fc00::/7)
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  // IPv6 AWS Nitro IMDSv2 endpoint (fd00:ec2::254) — more specific than fd00::/8 above
  // but listed explicitly for clarity
  // IPv6 link-local (fe80::/10)
  /^fe[89ab][0-9a-f]:/i,
  // IPv6 loopback variations
  /^0:0:0:0:0:0:0:1$/,
  // IPv4-mapped IPv6 hex form (::ffff:7f00:1 = ::ffff:127.0.0.1) not covered by dotted form
  /^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/i,
  // 6to4 encapsulation of private/loopback IPv4: 2002:7f00::/24, 2002:0a00::/24,
  // 2002:ac10::/28 (172.16-31.x), 2002:c0a8::/32 (192.168.x.x)
  /^2002:(7f|0a|ac1[0-9a-f]|c0a8):/i,
  // NAT64 well-known prefix (64:ff9b::/96) — maps IPv4 into IPv6
  /^64:ff9b:/i,
  // Hostnames that resolve to internal IPs
  /^localhost\.localdomain$/i,
  /^ip6-localhost$/i,
  /^ip6-loopback$/i,
] as const;

/**
 * Blocked port ranges for additional security
 */
const BLOCKED_PORTS = [
  // System ports
  0,  // Reserved
  7,  // Echo
  9,  // Discard
  11, // Systat
  13, // Daytime
  15, // Netstat
  17, // Qotd
  19, // Chargen
  20, // FTP data
  21, // FTP control
  22, // SSH
  23, // Telnet
  25, // SMTP
  37, // Time
  42, // WINS
  43, // Whois
  53, // DNS
  69, // TFTP
  79, // Finger
  // P0-FIX #6: Removed port 80 - standard HTTP port needed for legitimate outbound requests.
  // Blocking 80 caused validateUrl() to reject all standard HTTP URLs.
  88, // Kerberos
  110, // POP3
  111, // RPC
  113, // Ident
  119, // NNTP
  123, // NTP
  135, // MS-RPC
  137, // NetBIOS Name
  138, // NetBIOS Datagram
  139, // NetBIOS Session
  143, // IMAP
  161, // SNMP
  162, // SNMP Trap
  389, // LDAP
  // P0-FIX #6: Removed port 443 - standard HTTPS port needed for all secure outbound requests.
  // Blocking 443 caused validateUrl('https://api.example.com') to fail.
  445, // SMB
  513, // Rlogin
  514, // Syslog/Shell
  515, // Printer
  1080, // SOCKS
  1433, // MSSQL
  1434, // MSSQL Monitor
  1521, // Oracle
  2049, // NFS
  3306, // MySQL
  3389, // RDP
  5432, // PostgreSQL
  5632, // PCAnywhere
  5900, // VNC
  5984, // CouchDB
  6379, // Redis
  6380, // Redis alternative
  7001, // WebLogic
  8080, // HTTP alternate
  8443, // HTTPS alternate
  9200, // Elasticsearch
  9300, // Elasticsearch transport
  11211, // Memcached
  27017, // MongoDB
  27018, // MongoDB alternate
] as const;

/**
 * Check if a hostname is an internal/private IP address
 * SECURITY FIX: Issue 1 - SSRF protection
 *
 * @param hostname - Hostname to check
 * @returns True if the hostname is an internal IP
 */
export function isInternalIp(hostname: string): boolean {
  // Check against blocked patterns
  for (const pattern of INTERNAL_IP_PATTERNS) {
    if (pattern.test(hostname)) {
      return true;
    }
  }

  // Check for IP address in various formats
  // Handle IPv4 decimal/octal/hex encoding
  if (isEncodedInternalIp(hostname)) {
    return true;
  }

  return false;
}

/**
 * Check for encoded/internal IP addresses
 * Handles various encoding techniques used to bypass SSRF filters
 *
 * @param ip - IP address string to check
 * @returns True if the IP is internal when decoded
 */
function isEncodedInternalIp(ip: string): boolean {
  // Remove brackets for IPv6
  const cleanIp = ip.replace(/[[\]]/g, '');

  // Check for IPv4 in IPv6 format (::ffff:127.0.0.1)
  const ipv4Mapped = cleanIp.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4Mapped) {
    return isInternalIp(ipv4Mapped[1]!);
  }

  // Check for decimal IP encoding (2130706433 = 127.0.0.1)
  // Only treat pure numeric strings as decimal IPs — parseInt stops at non-digit chars
  // (e.g., parseInt('93.184.216.34', 10) = 93), causing false positives for dotted IPs.
  const decimalIp = /^\d+$/.test(cleanIp) ? parseInt(cleanIp, 10) : NaN;
  // SS-08-FIX: Lower bound was `> 0` which excluded 0x00000000 (correct) but also 0x00000001
  // (0.0.0.1, a reserved range). Upper bound was `< 0xFFFFFFFF` which excluded 255.255.255.255
  // (broadcast). Use `>= 0 && <= 0xFFFFFFFF` to cover the full 32-bit space and let
  // isInternalIp handle the individual range checks.
  if (!isNaN(decimalIp) && decimalIp >= 0 && decimalIp <= 0xFFFFFFFF) {
    const bytes = [
      (decimalIp >>> 24) & 0xFF,
      (decimalIp >>> 16) & 0xFF,
      (decimalIp >>> 8) & 0xFF,
      decimalIp & 0xFF,
    ];
    const normalizedIp = bytes.join('.');
    if (isInternalIp(normalizedIp)) {
      return true;
    }
  }

  // Check for octal/hex encoding in dotted notation
  const parts = cleanIp.split('.');
  if (parts.length === 4) {
    const normalizedParts = parts.map(p => {
      // Handle octal (0177.000.000.001)
      if (p.startsWith('0') && p.length > 1 && !p.includes('x')) {
        return parseInt(p, 8).toString();
      }
      // Handle hex (0x7f.0x00.0x00.0x01)
      if (p.startsWith('0x') || p.startsWith('0X')) {
        return parseInt(p, 16).toString();
      }
      return p;
    });
    const normalizedIp = normalizedParts.join('.');
    if (normalizedIp !== cleanIp && isInternalIp(normalizedIp)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a protocol is allowed
 * SECURITY FIX: Issue 1 - Block dangerous protocols
 *
 * @param protocol - Protocol to check (e.g., 'https:', 'http:')
 * @returns True if the protocol is allowed
 */
export function isAllowedProtocol(protocol: string): boolean {
  const normalizedProtocol = protocol.toLowerCase();

  // Only allow HTTP and HTTPS
  if (normalizedProtocol !== 'http:' && normalizedProtocol !== 'https:') {
    return false;
  }

  return true;
}

/**
 * Check if a port is allowed
 * SECURITY FIX: Issue 1 - Block dangerous ports
 *
 * @param port - Port number to check
 * @returns True if the port is allowed
 */
export function isAllowedPort(port: number): boolean {
  return !BLOCKED_PORTS.includes(port as typeof BLOCKED_PORTS[number]);
}

/**
 * SSRF validation result
 */
export interface SSRFValidationResult {
  allowed: boolean;
  reason?: string;
  sanitizedUrl?: string;
}

/**
 * Validate a URL for SSRF vulnerabilities
 * SECURITY FIX: Issue 1 - Comprehensive SSRF protection
 *
 * @param urlString - URL string to validate
 * @param options - Validation options
 * @returns Validation result
 */
// SS-02-FIX: Removed validateUrlWithDnsCheck. There were two exported async DNS-checking
// functions with subtly different DNS-error semantics:
//   - validateUrlWithDnsCheck: used resolve4+resolve6 in series with .catch(()=>[]),
//     silently swallowing IPv6 resolution errors.
//   - validateUrlWithDns (below): uses Promise.allSettled — correctly handles partial failures.
// validateUrlWithDnsCheck had no outside consumers. Callers should use validateUrlWithDns.

export function validateUrl(
  urlString: string,
  options: {
    allowHttp?: boolean;
    allowedPorts?: number[];
    requireHttps?: boolean;
  } = {}
): SSRFValidationResult {
  // Default: require HTTPS
  const requireHttps = options.requireHttps !== false;

  try {
    // Parse URL
    let url: URL;
    try {
      url = new URL(urlString);
    } catch {
      return { allowed: false, reason: 'Invalid URL format' };
    }

    // Check protocol
    if (!isAllowedProtocol(url.protocol)) {
      return {
        allowed: false,
        reason: `Protocol not allowed: ${url.protocol}`
      };
    }

    // Check HTTPS requirement
    if (requireHttps && url.protocol !== 'https:' && !options.allowHttp) {
      return {
        allowed: false,
        reason: 'HTTPS required'
      };
    }

    // Check hostname for internal IPs
    const hostname = url.hostname;
    if (isInternalIp(hostname)) {
      return {
        allowed: false,
        reason: 'Internal IP addresses not allowed'
      };
    }

    // SS-04-FIX: Use Number() instead of parseInt() for port parsing.
    // parseInt('443abc', 10) returns 443 — silently ignores trailing garbage.
    // Number() is strict: Number('443abc') === NaN, ensuring malformed ports are rejected.
    const rawPort = url.port;
    const parsedPort = rawPort === '' ? NaN : Number(rawPort);
    const port = Number.isInteger(parsedPort) && parsedPort > 0
      ? parsedPort
      : url.protocol === 'https:' ? 443 : 80;

    // Check explicitly blocked ports
    if (!isAllowedPort(port)) {
      return {
        allowed: false,
        reason: `Port not allowed: ${port}`
      };
    }

    // Check custom allowed ports
    if (options.allowedPorts && !options.allowedPorts.includes(port)) {
      return {
        allowed: false,
        reason: `Port not in allowed list: ${port}`
      };
    }

    // URL is safe (string-level check only — use validateUrlWithDns for full protection)
    return {
      allowed: true,
      sanitizedUrl: url.toString(),
    };
  } catch {
    // SS-05-FIX: Do not propagate internal error details through the reason field.
    // error.message can contain file paths, V8 stack details, or env information.
    // All such content is internal and must not reach callers (or their clients).
    return { allowed: false, reason: 'URL validation error' };
  }
}

/**
 * Resolve hostname and check all resolved IPs against internal IP blocklist.
 * P0-FIX: Prevents DNS rebinding SSRF attacks where an attacker registers
 * a domain (e.g., evil.com) that resolves to 127.0.0.1 or 169.254.169.254.
 * String-based hostname checks cannot detect this — DNS resolution is required.
 *
 * @param hostname - Hostname to resolve and validate
 * @returns Validation result
 */
export async function validateResolvedIps(hostname: string): Promise<SSRFValidationResult> {
  try {
    // Resolve both IPv4 and IPv6 addresses
    const [ipv4Addresses, ipv6Addresses] = await Promise.allSettled([
      dns.resolve4(hostname),
      dns.resolve6(hostname),
    ]);

    const allIps: string[] = [];
    if (ipv4Addresses.status === 'fulfilled') {
      allIps.push(...ipv4Addresses.value);
    }
    if (ipv6Addresses.status === 'fulfilled') {
      allIps.push(...ipv6Addresses.value);
    }

    // If no IPs resolved, the hostname doesn't exist
    if (allIps.length === 0) {
      return { allowed: false, reason: 'Hostname could not be resolved' };
    }

    // Check every resolved IP against internal IP blocklist
    for (const ip of allIps) {
      if (isInternalIp(ip)) {
        return {
          allowed: false,
          reason: `Hostname resolves to internal IP: ${ip}`,
        };
      }
    }

    return { allowed: true };
  } catch {
    return { allowed: false, reason: 'DNS resolution failed' };
  }
}

/**
 * Full SSRF-safe URL validation with DNS resolution.
 * P0-FIX: Combines string-based checks with DNS resolution to prevent
 * DNS rebinding attacks. Use this instead of validateUrl() for outbound requests.
 *
 * @param urlString - URL to validate
 * @param options - Validation options
 * @returns Validation result
 */
export async function validateUrlWithDns(
  urlString: string,
  options: {
    allowHttp?: boolean;
    allowedPorts?: number[];
    requireHttps?: boolean;
  } = {}
): Promise<SSRFValidationResult> {
  // First: run all synchronous string-based checks
  const stringResult = validateUrl(urlString, options);
  if (!stringResult.allowed) {
    return stringResult;
  }

  // Second: resolve DNS and validate resolved IPs
  const url = new URL(urlString);
  const dnsResult = await validateResolvedIps(url.hostname);
  if (!dnsResult.allowed) {
    return dnsResult;
  }

  return {
    allowed: true,
    ...(stringResult.sanitizedUrl != null ? { sanitizedUrl: stringResult.sanitizedUrl } : {}),
  };
}

/**
 * Extract and validate URL from user input, including DNS rebinding protection.
 *
 * SS-01-FIX: Converted from synchronous to async and now calls validateUrlWithDns()
 * instead of validateUrl(). The sync version only checked hostname strings against
 * patterns but never resolved DNS. An attacker who registers evil.com → 127.0.0.1
 * (DNS rebinding) passed the sync check — the hostname "evil.com" matched no blocked
 * pattern. The function name "extractSafeUrl" implied DNS-rebinding safety that did
 * not exist. validateUrlWithDns() resolves DNS and rejects hostnames that resolve to
 * internal addresses.
 *
 * @param input - User input potentially containing URL
 * @returns Validated URL or null if unsafe
 */
export async function extractSafeUrl(input: string): Promise<string | null> {
  // Remove whitespace and control characters
  // eslint-disable-next-line no-control-regex
  const cleaned = input.trim().replace(/[\x00-\x1F\x7F]/g, '');

  // Check for URL obfuscation attempts before making any network calls.
  // P1-FIX #11: Removed /\/\// pattern — it matched the :// in every URL's protocol,
  // causing extractSafeUrl() to return null for ALL valid URLs.
  // P2-10 FIX: Only check for @ in authority portion (credentials), not in paths
  // (URLs like https://medium.com/@author are legitimate).
  // SS-07-FIX: Removed /g flag from all patterns. The g flag makes RegExp objects
  // stateful (lastIndex). Patterns in a local array are recreated each call here,
  // so it is safe now, but removing /g prevents breakage if ever hoisted to module scope.
  const suspiciousPatterns = [
    /\/\/[^/]*@/,  // Credentials in authority (user:pass@host) - only before first path /
    /\\/,          // Backslash (Windows path / auth bypass)
    /\.\./,        // Path traversal
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(cleaned)) {
      return null;
    }
  }

  // Validate with DNS resolution to catch DNS rebinding attacks
  const result = await validateUrlWithDns(cleaned);
  if (result.allowed && result.sanitizedUrl) {
    return result.sanitizedUrl;
  }

  return null;
}

/**
 * Normalize IP address for comparison
 * SECURITY FIX: Issue 1 - Handle various IP encodings
 *
 * @param ip - IP address to normalize
 * @returns Normalized IP or null if invalid
 */
export function normalizeIp(ip: string): string | null {
  try {
    // Remove brackets
    const cleanIp = ip.replace(/[[\]]/g, '');

    // Handle IPv4-mapped IPv6 (::ffff:x.x.x.x)
    const ipv4Mapped = cleanIp.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (ipv4Mapped) {
      return ipv4Mapped[1] ?? null;
    }

    // Handle decimal notation — only for pure numeric strings
    const decimal = /^\d+$/.test(cleanIp) ? parseInt(cleanIp, 10) : NaN;
    if (!isNaN(decimal) && decimal >= 0 && decimal <= 0xFFFFFFFF) {
      return [
        (decimal >>> 24) & 0xFF,
        (decimal >>> 16) & 0xFF,
        (decimal >>> 8) & 0xFF,
        decimal & 0xFF,
      ].join('.');
    }

    // Handle standard dotted notation with octal/hex
    const parts = cleanIp.split('.');
    if (parts.length === 4) {
      const normalized = parts.map(p => {
        if (p.startsWith('0x') || p.startsWith('0X')) {
          return parseInt(p, 16);
        }
        if (p.startsWith('0') && p.length > 1) {
          return parseInt(p, 8);
        }
        return parseInt(p, 10);
      });

      if (normalized.every(n => !isNaN(n) && n >= 0 && n <= 255)) {
        return normalized.join('.');
      }
    }

    return cleanIp;
  } catch {
    return null;
  }
}

// P2-FIX: Removed empty default export — it served no purpose and encouraged
// incorrect default-import usage. All exports are named.
