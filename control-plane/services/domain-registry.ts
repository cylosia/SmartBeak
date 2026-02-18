const VALID_DOMAIN_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

// In production, back this with a real DB.
// For now, use env-based mapping.
export function resolveDomainDb(domainId: string): string {
  if (!VALID_DOMAIN_ID_REGEX.test(domainId)) {
  throw new Error(`Invalid domain ID format: ${domainId}`);
  }

  // REG-1-FIX P1: Replace hyphens with underscores before constructing the env key.
  // Environment variable names containing '-' are invalid in POSIX (and silently
  // undefined in Kubernetes). A domain ID like 'foo-bar' produced key
  // DOMAIN_FOO-BAR_DB which Kubernetes would never set, causing silent undefined reads.
  const cs = process.env[`DOMAIN_${domainId.toUpperCase().replace(/-/g, '_')}_DB`];
  if (!cs) throw new Error(`Missing DB for domain ${domainId}`);
  return cs;
}
