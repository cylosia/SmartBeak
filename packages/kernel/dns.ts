import dns from 'dns/promises';

﻿import crypto from 'crypto';

/**
* DNS Verification Utilities
* Cross-platform DNS verification for domain ownership
*/

// FIX: Domain validation regex - RFC 1035 compliant
const DOMAIN_REGEX = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])$/;
const MAX_DOMAIN_LENGTH = 253;

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
  if (!DOMAIN_REGEX.test(domain)) {
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
  const records = await dns.resolveTxt(`_acp-verification.${domain}`);
  return records.flat().includes(token);
  } catch (error: unknown) {
  // DNS resolution failed or record not found
  const dnsError = error as { code?: string };
  if (dnsError.code === 'ENOTFOUND' || dnsError.code === 'ENODATA') {
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
  if (!method.record || typeof method.record !== 'string') {
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
    const records = await dns.resolveTxt(method.record);
    results[method.record] = records.flat().includes(method["token"]);
    }
  } catch (error: unknown) {
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
  const records = await dns.resolveTxt(domain);
  return records.flat();
  } catch (error: unknown) {
  const dnsError = error as { code?: string };
  if (dnsError.code === 'ENOTFOUND' || dnsError.code === 'ENODATA') {
    return [];
  }
  throw error;
  }
}
