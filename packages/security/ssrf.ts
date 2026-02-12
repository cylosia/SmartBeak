/**
 * SSRF Protection Utility
 * Prevents Server-Side Request Forgery attacks by blocking internal IP addresses
 *
 * P1-HIGH SECURITY FIX: Issue 1 - SSRF vulnerability protection
 */

import { URL } from 'url';
import { promises as dns } from 'dns';

/**
 * Internal IP patterns to block
 * Covers IPv4 private ranges, loopback, and IPv6 unique local/link-local
 */
const INTERNAL_IP_PATTERNS = [
  // IPv4 loopback
  /^127\./,
  /^localhost$/i,
  // IPv4 private ranges
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  // IPv4 link-local
  /^169\.254\./,
  // IPv4 zero/current network
  /^0\./,
  /^0\.0\.0\.0$/,
  // IPv6 loopback
  /^::1$/,
  // IPv6 unique local (fc00::/7)
  /^fc[0-9a-f]{2}:/i,
  /^fd[0-9a-f]{2}:/i,
  // IPv6 link-local (fe80::/10)
  /^fe[89ab][0-9a-f]:/i,
  // IPv6 loopback variations
  /^0:0:0:0:0:0:0:1$/,
  // Hostnames that resolve to internal IPs
  /^localhost\.localdomain$/i,
  /^ip6-localhost$/i,
  /^ip6-loopback$/i,
] as const;

/**
 * Blocked protocols to prevent URL-based attacks
 */
const BLOCKED_PROTOCOLS = [
  'file:',
  'ftp:',
  'ftps:',
  'gopher:',
  'dict:',
  'ldap:',
  'ldaps:',
  'tftp:',
  'sftp:',
  'scp:',
  'svn:',
  'svn+ssh:',
  'ssh:',
  'telnet:',
  'smtp:',
  'imap:',
  'pop3:',
  'sip:',
  'sips:',
  'xmpp:',
  'nfs:',
  'snmp:',
  'rtsp:',
  'rtmp:',
  'jar:',
  'file://',
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
  const cleanIp = ip.replace(/[\[\]]/g, '');

  // Check for IPv4 in IPv6 format (::ffff:127.0.0.1)
  const ipv4Mapped = cleanIp.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (ipv4Mapped) {
    return isInternalIp(ipv4Mapped[1]!);
  }

  // Check for decimal IP encoding (2130706433 = 127.0.0.1)
  const decimalIp = parseInt(cleanIp, 10);
  if (!isNaN(decimalIp) && decimalIp > 0 && decimalIp < 0xFFFFFFFF) {
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

    // Check port
    const port = parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80);

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
  } catch (error) {
    return {
      allowed: false,
      reason: `URL validation error: ${error instanceof Error ? error["message"] : String(error)}`
    };
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
    sanitizedUrl: stringResult.sanitizedUrl,
  };
}

/**
 * Extract and validate URL from user input
 * SECURITY FIX: Issue 1 - Safe URL extraction
 *
 * @param input - User input potentially containing URL
 * @returns Validated URL or null if unsafe
 */
export function extractSafeUrl(input: string): string | null {
  // Remove whitespace and control characters
  const cleaned = input.trim().replace(/[\x00-\x1F\x7F]/g, '');

  // Check for URL obfuscation attempts
  // P1-FIX #11: Removed /\/\//g pattern - it matched the :// in every URL's protocol,
  // causing extractSafeUrl() to return null for ALL valid URLs.
  // Protocol-relative URLs are already handled by the protocol allowlist check below.
  const suspiciousPatterns = [
    /@/g,           // Credentials in URL
    /#.*@/g,       // Fragment with @
    /\\/g,         // Backslash (Windows path / auth bypass)
    /\.\./g,       // Path traversal
  ];

  for (const pattern of suspiciousPatterns) {
    if (pattern.test(cleaned)) {
      return null;
    }
  }

  // Validate the URL
  const result = validateUrl(cleaned);
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
    let cleanIp = ip.replace(/[\[\]]/g, '');

    // Handle IPv4-mapped IPv6 (::ffff:x.x.x.x)
    const ipv4Mapped = cleanIp.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (ipv4Mapped) {
      return ipv4Mapped[1] ?? null;
    }

    // Handle decimal notation
    const decimal = parseInt(cleanIp, 10);
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

// Default export
export default {
};
