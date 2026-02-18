import crypto from 'crypto';

import { getLogger } from '@kernel/logger';
import { getRedis } from '@kernel/redis';

/**
* DNS Verification Service
* @deprecated Use @kernel/dns instead
* This file is kept for backward compatibility and provides
* re-exports from the kernel DNS module with additional error handling.
*/

const logger = getLogger('dns-verifier');

/**
 * BUG-DNS-02 fix: use a dedicated error class for input-validation failures so the
 * outer catch can reliably suppress duplicate logs without fragile message-string
 * matching (error.message.includes('Invalid') incorrectly suppressed legitimate
 * transient DNS errors whose messages happened to contain the word 'Invalid').
 */
class DnsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DnsValidationError';
  }
}

// Negative cache: store failed DNS verification results to prevent
// attackers from hammering the verifier with failing domains.
const DNS_NEGATIVE_CACHE_TTL_SECONDS = 300; // 5 minutes
const DNS_CACHE_PREFIX = 'dns:neg:';

// Block localhost and private IP ranges to prevent DNS rebinding attacks
const REBINDING_PATTERNS = [
  /^localhost$/i,
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2[0-9]|3[01])\./,
  /^169\.254\./,
  /^0\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

/**
* Check if domain is potentially a DNS rebinding attack
*/
function isPotentialRebindingAttack(domain: string): boolean {
  return REBINDING_PATTERNS.some(pattern => pattern.test(domain));
}

// Re-export the token generator only.
// P1-FIX: verifyDns is intentionally NOT re-exported here. The raw kernel function
// has no DNS rebinding protection (localhost, 127.x, 10.x, 192.168.x, RFC-1918 ranges).
// All callers must use verifyDnsSafe() below which enforces the rebinding check and
// prevents SSRF via DNS rebinding attacks.
export { generateDnsToken } from '@kernel/dns';

// Import for wrapper functions
import {
  generateDnsToken as kernelGenerateDnsToken,
  verifyDns as kernelVerifyDns,
  verifyDnsMulti as kernelVerifyDnsMulti,
  getDnsTxtRecords as kernelGetDnsTxtRecords,
} from '@kernel/dns';

/**
* Generate a DNS verification token with error handling
* @returns A unique verification token string
* @throws Error if token generation fails
*/
export function generateDnsTokenSafe(): string {
  try {
  const token = kernelGenerateDnsToken();
  logger.debug('DNS token generated successfully');
  return token;
  } catch (error) {
  logger.error(
    'Failed to generate DNS token',
    error instanceof Error ? error : new Error(String(error))
  );
  throw new Error('Failed to generate DNS verification token');
  }
}

/**
* Verify DNS TXT record for domain ownership with enhanced error handling
* @param domain - The domain to verify
* @param token - The verification token to look for
* @returns True if token found in DNS TXT records, false otherwise
* @throws Error if verification fails unexpectedly
*/
export async function verifyDnsSafe(domain: string, token: string): Promise<boolean> {
  try {
  // Validate inputs.
  // BUG-DNS-03 fix: trim before the length check so domains with surrounding whitespace
  // are not incorrectly rejected (previously domain.length > 253 ran on the raw input
  // before trim(), rejecting valid domains padded with spaces).
  if (typeof domain !== 'string') {
    logger.error('Invalid domain for DNS verification', new Error('Validation failed'), {});
    throw new DnsValidationError('Invalid domain: must be a valid domain string');
  }
  const trimmedDomain = domain.trim();
  if (trimmedDomain.length === 0 || trimmedDomain.length > 253) {
    logger.error('Invalid domain for DNS verification', new Error('Validation failed'), {});
    throw new DnsValidationError('Invalid domain: must be a valid domain string');
  }

  if (typeof token !== 'string' || token.length === 0) {
    logger.error('Invalid token for DNS verification', new Error('Validation failed'), {});
    throw new DnsValidationError('Invalid token: must be a non-empty string');
  }

  // Sanitize domain (basic validation)
  const sanitizedDomain = trimmedDomain.toLowerCase();
  // DNSV-1-FIX P1: Original regex allowed '..' (consecutive dots) because the
  // character class [a-z0-9.-]* permits any sequence of those chars. RFC 1035
  // §2.3.1 forbids empty labels (which consecutive dots produce).
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(sanitizedDomain) || sanitizedDomain.includes('..')) {
    logger.error('Domain format validation failed', new Error('Validation failed'), {
    domain: sanitizedDomain,
    });
    throw new DnsValidationError('Invalid domain format');
  }

  if (isPotentialRebindingAttack(sanitizedDomain)) {
    logger.error('Potential DNS rebinding attack detected', new Error('Security validation failed'), {
    domain: sanitizedDomain,
    });
    throw new DnsValidationError('Invalid domain: potential security risk');
  }

  // DNSV-2-FIX P2: Key the negative cache on domain + token hash, not domain alone.
  // A domain-only key means org A's failed verification poisons the cache for org B's
  // valid (different) token on the same domain — effectively a cross-org DoS.
  const tokenHash = crypto.createHash('sha256').update(token.trim()).digest('hex').substring(0, 16);
  const cacheKey = `${DNS_CACHE_PREFIX}${sanitizedDomain}:${tokenHash}`;
  try {
    const redis = await getRedis();
    const cached = await redis.get(cacheKey);
    if (cached === 'miss') {
    logger.debug('DNS verification cache hit (negative)', { domain: sanitizedDomain });
    return false;
    }
  } catch (cacheError) {
    logger.warn('DNS negative cache read failed, proceeding with live lookup', {
    error: cacheError instanceof Error ? cacheError.message : String(cacheError),
    });
  }

  const result = await kernelVerifyDns(sanitizedDomain, token.trim());

  if (result) {
    // BUG-DNS-01 fix: clear any stale negative cache entry after a successful verification.
    // Without this, a domain that previously failed (and was cached as 'miss') remains
    // blocked for up to DNS_NEGATIVE_CACHE_TTL_SECONDS even after the TXT record is added.
    try {
      const redis = await getRedis();
      await redis.del(cacheKey);
      logger.debug('DNS negative cache cleared after successful verification', { domain: sanitizedDomain });
    } catch (cacheError) {
      logger.warn('Failed to clear DNS negative cache after successful verification', {
        error: cacheError instanceof Error ? cacheError.message : String(cacheError),
      });
    }
  } else {
    // Cache negative results to prevent DNS quota exhaustion
    try {
      const redis = await getRedis();
      await redis.setex(cacheKey, DNS_NEGATIVE_CACHE_TTL_SECONDS, 'miss');
    } catch (cacheError) {
      logger.warn('DNS negative cache write failed', {
        error: cacheError instanceof Error ? cacheError.message : String(cacheError),
      });
    }
  }

  logger.info('DNS verification completed', {
    domain: sanitizedDomain,
    verified: result,
  });

  return result;
  } catch (error) {
  // BUG-DNS-02 fix: use instanceof DnsValidationError instead of
  // error.message.includes('Invalid'), which was a fragile heuristic that could
  // suppress legitimate transient DNS error logs if the error message happened to
  // contain the word 'Invalid' (e.g. "Invalid nameserver response").
  if (!(error instanceof DnsValidationError)) {
    // L04-FIX: Don't log the token value — only log the domain
    logger.error(
    'DNS verification failed',
    error instanceof Error ? error : new Error(String(error)),
    { domain }
    );
  }
  throw error;
  }
}

/**
* DNS verification method configuration
*/
export interface DnsVerificationMethod {
  type: 'txt';
  record: string;
  token: string;
}

/**
* Verify DNS records for multiple verification methods with error handling
* @param domain - The domain to verify
* @param methods - Array of verification methods to check
* @returns Object with results for each method
* @throws Error if verification fails
*/
export async function verifyDnsMultiSafe(
  domain: string,
  methods: DnsVerificationMethod[]
): Promise<Record<string, boolean>> {
  try {
  // Validate domain
  if (typeof domain !== 'string' || domain.length === 0) {
    logger.error('Invalid domain for multi DNS verification', new Error('Validation failed'), {
    });
    throw new Error('Invalid domain');
  }

  // Validate methods array
  if (!Array.isArray(methods) || methods.length === 0) {
    logger.error('Invalid methods for DNS verification', new Error('Validation failed'), {
    });
    throw new Error('Methods must be a non-empty array');
  }

  // Validate each method
  for (const method of methods) {
    if (
    !method ||
    typeof method !== 'object' ||
    method.type !== 'txt' ||
    typeof method.record !== 'string' ||
    typeof method.token !== 'string'
    ) {
    logger.error('Invalid verification method', new Error('Validation failed'), { method });
    throw new Error('Each method must have type: \'txt\', record: string, token: string');
    }
  }

  const sanitizedDomain = domain.trim().toLowerCase();

  // P1-REBINDING-FIX: Added DNS rebinding check. verifyDnsSafe() had this check but
  // verifyDnsMultiSafe() and getDnsTxtRecordsSafe() did not, creating an inconsistent
  // security posture — attackers could bypass the rebinding protection by using the
  // multi-method or TXT lookup APIs to resolve internal IP ranges.
  if (isPotentialRebindingAttack(sanitizedDomain)) {
    logger.error('Potential DNS rebinding attack detected in multi-verify', new Error('Security validation failed'), {
    domain: sanitizedDomain,
    });
    throw new DnsValidationError('Invalid domain: potential security risk');
  }

  const sanitizedMethods = methods.map((m) => ({
    type: m.type as 'txt',
    record: m.record.trim(),
    token: m.token.trim(),
  }));

  const results = await kernelVerifyDnsMulti(sanitizedDomain, sanitizedMethods);

  logger.info('Multi DNS verification completed', {
    domain: sanitizedDomain,
    methodCount: methods.length,
    successCount: Object.values(results).filter(Boolean).length,
  });

  return results;
  } catch (error) {
  logger.error(
    'Multi DNS verification failed',
    error instanceof Error ? error : new Error(String(error)),
    { domain, methodCount: methods?.length }
  );
  throw error;
  }
}

/**
* Get DNS TXT records for a domain with error handling
* @param domain - The domain to query
* @returns Array of TXT record values
* @throws Error if query fails
*/
export async function getDnsTxtRecordsSafe(domain: string): Promise<string[]> {
  try {
  // Validate domain
  if (typeof domain !== 'string' || domain.length === 0 || domain.length > 253) {
    logger.error('Invalid domain for TXT records query', new Error('Validation failed'), {
    });
    throw new Error('Invalid domain');
  }

  const sanitizedDomain = domain.trim().toLowerCase();

  // P1-REBINDING-FIX: Added DNS rebinding check (same rationale as verifyDnsMultiSafe fix).
  if (isPotentialRebindingAttack(sanitizedDomain)) {
    logger.error('Potential DNS rebinding attack detected in TXT lookup', new Error('Security validation failed'), {
    domain: sanitizedDomain,
    });
    throw new DnsValidationError('Invalid domain: potential security risk');
  }

  const records = await kernelGetDnsTxtRecords(sanitizedDomain);

  logger.debug('DNS TXT records retrieved', {
    domain: sanitizedDomain,
    recordCount: records.length,
  });

  return records;
  } catch (error) {
  logger.error(
    'Failed to get DNS TXT records',
    error instanceof Error ? error : new Error(String(error)),
    { domain }
  );
  throw error;
  }
}
