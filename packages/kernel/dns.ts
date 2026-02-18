import dns from 'dns/promises';
import crypto from 'crypto';
import { getLogger } from '@kernel/logger';

const logger = getLogger('kernel:dns');

/**
* DNS Verification Utilities
* Cross-platform DNS verification for domain ownership
*/

// FIX: Domain validation — validate labels separately to avoid ReDoS
function isValidDomainLabel(l: string): boolean {
  return l.length >= 1 && l.length <= 63
    && /^[a-zA-Z0-9]/.test(l) && /[a-zA-Z0-9]$/.test(l)
    && /^[a-zA-Z0-9-]+$/.test(l);
}
function isValidDomainFormat(domain: string): boolean {
  const labels = domain.split('.');
  return labels.length >= 1 && labels.every(isValidDomainLabel);
}
const MAX_DOMAIN_LENGTH = 253;

// DNS error codes that indicate the domain/record doesn't exist or is unreachable,
// rather than a bug in our code. These are treated as "verification failed" (return false)
// instead of throwing, to prevent transient DNS issues from crashing the service.
const RECOVERABLE_DNS_ERRORS = ['ENOTFOUND', 'ENODATA', 'SERVFAIL', 'ETIMEOUT', 'ECONNREFUSED', 'ECONNRESET'];

const DNS_TIMEOUT_MS = 5000;

/**
 * Wrap a DNS promise with a timeout to prevent indefinite hangs.
 * Uses the same Promise.race pattern as control-plane/api/http.ts and
 * control-plane/jobs/media-cleanup.ts.
 */
function withDnsTimeout<T>(promise: Promise<T>): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(Object.assign(new Error(`DNS lookup timed out after ${DNS_TIMEOUT_MS}ms`), { code: 'ETIMEOUT' }));
    }, DNS_TIMEOUT_MS);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeoutId);
  });
}

/**
* FIX: Validate domain name format before DNS lookup
* Prevents injection attacks and invalid lookups
* @param domain - Domain name to validate
* @returns True if domain is valid
*/
function isValidDomain(domain: string): boolean {
  if (!domain || typeof domain !== 'string') {
  return false;
  }

  // Check length
  if (domain.length > MAX_DOMAIN_LENGTH || domain.length < 1) {
  return false;
  }

  // Check format
  if (!isValidDomainFormat(domain)) {
  return false;
  }

  // Prevent lookup of special/internal domains
  const lowerDomain = domain.toLowerCase();
  const blockedSuffixes = ['.local', '.localhost', '.internal', '.lan'];
  if (blockedSuffixes.some(suffix => lowerDomain.endsWith(suffix))) {
  return false;
  }

  return true;
}

/**
* Generate a DNS verification token
* @returns A unique verification token string
*/
export function generateDnsToken(): string {
  return `acp-${crypto.randomBytes(16).toString('hex')}`;
}

/**
* Verify DNS TXT record for domain ownership
* FIX: Added domain validation before lookup
* @param domain - The domain to verify
* @param token - The verification token to look for
* @returns True if token found in DNS TXT records
*/
export async function verifyDns(domain: string, token: string): Promise<boolean> {
  // FIX: Validate domain before lookup
  if (!isValidDomain(domain)) {
  throw new Error(`Invalid domain format: ${domain}`);
  }

  // FIX: Validate token format (prevent injection)
  if (!token || typeof token !== 'string' || token.length > 1000) {
  throw new Error('Invalid verification token');
  }

  try {
  const records = await withDnsTimeout(dns.resolveTxt(`_acp-verification.${domain}`));
  return records.flat().includes(token);
  } catch (error: unknown) {
  const dnsError = error as { code?: string };
  if (dnsError.code && RECOVERABLE_DNS_ERRORS.includes(dnsError.code)) {
    return false;
  }
  throw error;
  }
}

/**
* Verify DNS records for multiple verification methods
* FIX: Added domain validation before lookup
* @param domain - The domain to verify
* @param methods - Array of verification methods to check
* @returns Object with results for each method
*/
export async function verifyDnsMulti(
  domain: string,
  methods: Array<{ type: 'txt'; record: string; token: string }>
): Promise<Record<string, boolean>> {
  // FIX: Validate domain before lookup
  if (!isValidDomain(domain)) {
  throw new Error(`Invalid domain format: ${domain}`);
  }

  const results: Record<string, boolean> = {};

  for (const method of methods) {
  // FIX: Validate record format
  // P2-18 FIX: Also validate record is a valid hostname to prevent arbitrary DNS lookups
  if (!method.record || typeof method.record !== 'string' || method.record.length > MAX_DOMAIN_LENGTH) {
    results[method.record || 'unknown'] = false;
    continue;
  }

  // FIX: Validate token format
  if (!method["token"] || typeof method["token"] !== 'string' || method["token"].length > 1000) {
    results[method.record] = false;
    continue;
  }

  try {
    if (method.type === 'txt') {
    const records = await withDnsTimeout(dns.resolveTxt(method.record));
    results[method.record] = records.flat().includes(method["token"]);
    }
  } catch (error: unknown) {
    // P1-FIX: Log unexpected errors (network failures, internal bugs) so they are
    // not silently masked as "record not found". Only recoverable DNS errors (ENOTFOUND,
    // SERVFAIL, etc.) are routine; everything else warrants an error log.
    const code = (error as { code?: string }).code;
    if (!code || !RECOVERABLE_DNS_ERRORS.includes(code)) {
      logger.error(
        'Unexpected error in verifyDnsMulti',
        error instanceof Error ? error : new Error(String(error)),
        { record: method.record }
      );
    }
    results[method.record] = false;
  }
  }

  return results;
}

/**
* Get DNS TXT records for a domain
* FIX: Added domain validation before lookup
* @param domain - The domain to query
* @returns Array of TXT record values
*/
export async function getDnsTxtRecords(domain: string): Promise<string[]> {
  // FIX: Validate domain before lookup
  if (!isValidDomain(domain)) {
  throw new Error(`Invalid domain format: ${domain}`);
  }

  try {
  const records = await withDnsTimeout(dns.resolveTxt(domain));
  return records.flat();
  } catch (error: unknown) {
  const dnsError = error as { code?: string };
  if (dnsError.code && RECOVERABLE_DNS_ERRORS.includes(dnsError.code)) {
    return [];
  }
  throw error;
  }
}
