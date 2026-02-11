import { getLogger } from '@kernel/logger';

/**
* DNS Verification Service
* @deprecated Use @kernel/dns instead
* This file is kept for backward compatibility and provides
* re-exports from the kernel DNS module with additional error handling.
*/

const logger = getLogger('dns-verifier');

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

// Re-export from kernel
export { generateDnsToken, verifyDns } from '../../packages/kernel/dns';

// Import for wrapper functions
import {
  generateDnsToken as kernelGenerateDnsToken,
  verifyDns as kernelVerifyDns,
  verifyDnsMulti as kernelVerifyDnsMulti,
  getDnsTxtRecords as kernelGetDnsTxtRecords,
} from '../../packages/kernel/dns';

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
  logger["error"](
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
  // Validate inputs
  if (typeof domain !== 'string' || domain.length === 0 || domain.length > 253) {
    logger["error"]('Invalid domain for DNS verification', new Error('Validation failed'), {
    });
    throw new Error('Invalid domain: must be a valid domain string');
  }

  if (typeof token !== 'string' || token.length === 0) {
    logger["error"]('Invalid token for DNS verification', new Error('Validation failed'), {
    });
    throw new Error('Invalid token: must be a non-empty string');
  }

  // Sanitize domain (basic validation)
  const sanitizedDomain = domain.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(sanitizedDomain)) {
    logger["error"]('Domain format validation failed', new Error('Validation failed'), {
    domain: sanitizedDomain,
    });
    throw new Error('Invalid domain format');
  }

  if (isPotentialRebindingAttack(sanitizedDomain)) {
    logger["error"]('Potential DNS rebinding attack detected', new Error('Security validation failed'), {
    domain: sanitizedDomain,
    });
    throw new Error('Invalid domain: potential security risk');
  }

  const result = await kernelVerifyDns(sanitizedDomain, token.trim());

  logger.info('DNS verification completed', {
    domain: sanitizedDomain,
    verified: result,
  });

  return result;
  } catch (error) {
  // Don't log if it's a validation error we already logged
  // Check for validation error using error code or message pattern
  const customError = error as Error & { code?: string };
  const isValidationError = error instanceof Error &&
    (customError.code === 'VALIDATION_ERROR' || error.message.includes('Invalid'));
  if (!isValidationError) {
    logger["error"](
    'DNS verification failed',
    error instanceof Error ? error : new Error(String(error)),
    { domain, token }
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
    logger["error"]('Invalid domain for multi DNS verification', new Error('Validation failed'), {
    });
    throw new Error('Invalid domain');
  }

  // Validate methods array
  if (!Array.isArray(methods) || methods.length === 0) {
    logger["error"]('Invalid methods for DNS verification', new Error('Validation failed'), {
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
    logger["error"]('Invalid verification method', new Error('Validation failed'), { method });
    throw new Error('Each method must have type: \'txt\', record: string, token: string');
    }
  }

  const sanitizedDomain = domain.trim().toLowerCase();
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
  logger["error"](
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
    logger["error"]('Invalid domain for TXT records query', new Error('Validation failed'), {
    });
    throw new Error('Invalid domain');
  }

  const sanitizedDomain = domain.trim().toLowerCase();

  const records = await kernelGetDnsTxtRecords(sanitizedDomain);

  logger.debug('DNS TXT records retrieved', {
    domain: sanitizedDomain,
    recordCount: records.length,
  });

  return records;
  } catch (error) {
  logger["error"](
    'Failed to get DNS TXT records',
    error instanceof Error ? error : new Error(String(error)),
    { domain }
  );
  throw error;
  }
}
