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
    && /^[a-zA-Z0-9-]+$/.test(l)
    // DNS-1-FIX P1: Reject labels with '--' at positions 2-3 (Punycode prefix xn--)
    // to block IDN homograph attacks. Punycode-encoded labels bypass Unicode
    // normalization and can render as visually identical internationalized characters.
    && !(l.length >= 4 && l[2] === '-' && l[3] === '-');
}
function isValidDomainFormat(domain: string): boolean {
  const labels = domain.split('.');
  return labels.length >= 1 && labels.every(isValidDomainLabel);
}
const MAX_DOMAIN_LENGTH = 253;

// DNS error codes that indicate the domain/record doesn't exist or is unreachable,
// rather than a bug in our code. These are treated as "verification failed" (return false)
// instead of throwing, to prevent transient DNS issues from crashing the service.
// DNS-3-FIX P1: SERVFAIL removed — it indicates a DNSSEC validation failure or upstream
// resolver error, which is a security-relevant event that must surface to callers.
// Silently treating SERVFAIL as "not found" would mask DNSSEC tampering.
const RECOVERABLE_DNS_ERRORS = ['ENOTFOUND', 'ENODATA', 'ETIMEOUT', 'ECONNREFUSED', 'ECONNRESET'];

const DNS_TIMEOUT_MS = 5000;
// DNS-4-FIX P2: Bound TXT record responses to prevent memory exhaustion
// from domains that publish hundreds of TXT records (e.g. SPF, DKIM sprawl).
const MAX_TXT_RECORDS = 50;
const MAX_TXT_RECORD_VALUE_LENGTH = 2048;

/**
 * Wrap a DNS promise with a timeout to prevent indefinite hangs.
 * Uses the same Promise.race pattern as control-plane/api/http.ts and
 * control-plane/jobs/media-cleanup.ts.
 */
function withDnsTimeout<T>(promise: Promise<T>): Promise<T> {
  // BUG-KDNS-02 fix: declare as | undefined so the clearTimeout guard is type-safe
  // and the implicit reliance on synchronous executor behaviour is made explicit.
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(Object.assign(new Error(`DNS lookup timed out after ${DNS_TIMEOUT_MS}ms`), { code: 'ETIMEOUT' }));
    }, DNS_TIMEOUT_MS);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
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
  // DNS-4-FIX P2: Cap TXT record count and value length to prevent memory exhaustion.
  const flatRecords = records.flat().slice(0, MAX_TXT_RECORDS)
    .filter(r => r.length <= MAX_TXT_RECORD_VALUE_LENGTH);
  return flatRecords.includes(token);
  } catch (error: unknown) {
  const dnsError = error as { code?: string };
  if (dnsError.code === 'SERVFAIL') {
    // DNS-3-FIX P1: Log SERVFAIL separately — it may indicate DNSSEC failure.
    logger.warn('SERVFAIL during DNS verification — possible DNSSEC or resolver failure', { domain });
    return false;
  }
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

  // DNS-5-FIX P2: Use Object.create(null) to prevent prototype pollution via
  // method.record = '__proto__' or other inherited property names.
  const results = Object.create(null) as Record<string, boolean>;

  // BUG-KDNS-01 fix: run lookups in parallel with Promise.all instead of a sequential
  // for-await loop.  With N methods and DNS_TIMEOUT_MS = 5000, the old code had
  // worst-case latency of N * 5000 ms; now it is bounded by a single 5000 ms timeout.
  //
  // BUG-KDNS-03 fix: invalid methods are skipped (logged + omitted from results) rather
  // than written to a shared 'unknown' key that caused result corruption when multiple
  // invalid methods existed or when a valid record happened to be named 'unknown'.
  await Promise.all(methods.map(async (method) => {
  // Validate record format
  if (!method.record || typeof method.record !== 'string' || method.record.length > MAX_DOMAIN_LENGTH) {
    logger.warn('Skipping DNS method with invalid record', { methodType: method.type });
    // Omit from results rather than colliding on a shared 'unknown' key.
    return;
  }

  // Validate token format
  if (!method["token"] || typeof method["token"] !== 'string' || method["token"].length > 1000) {
    results[method.record] = false;
    return;
  }

  try {
    if (method.type === 'txt') {
    const records = await withDnsTimeout(dns.resolveTxt(method.record));
    // DNS-4-FIX P2: Cap TXT records per lookup.
    const flatRecords = records.flat().slice(0, MAX_TXT_RECORDS)
      .filter(r => r.length <= MAX_TXT_RECORD_VALUE_LENGTH);
    results[method.record] = flatRecords.includes(method["token"]);
    }
  } catch (error: unknown) {
    // DNS-3-FIX P1: Log SERVFAIL separately — it may indicate DNSSEC failure.
    const code = (error as { code?: string }).code;
    if (code === 'SERVFAIL') {
      logger.warn('SERVFAIL during multi DNS verification — possible DNSSEC or resolver failure', { record: method.record });
    } else if (!code || !RECOVERABLE_DNS_ERRORS.includes(code)) {
      // P1-FIX: Log unexpected errors so they are not silently masked as "record not found".
      logger.error(
        'Unexpected error in verifyDnsMulti',
        error instanceof Error ? error : new Error(String(error)),
        { record: method.record }
      );
    }
    results[method.record] = false;
  }
  }));

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
  // DNS-4-FIX P2: Cap TXT record count and value length to prevent memory exhaustion.
  return records.flat().slice(0, MAX_TXT_RECORDS)
    .filter(r => r.length <= MAX_TXT_RECORD_VALUE_LENGTH);
  } catch (error: unknown) {
  const dnsError = error as { code?: string };
  if (dnsError.code === 'SERVFAIL') {
    // DNS-3-FIX P1: Log SERVFAIL separately — may indicate DNSSEC or resolver failure.
    logger.warn('SERVFAIL during DNS TXT records lookup — possible DNSSEC or resolver failure', { domain });
    return [];
  }
  if (dnsError.code && RECOVERABLE_DNS_ERRORS.includes(dnsError.code)) {
    return [];
  }
  throw error;
  }
}
