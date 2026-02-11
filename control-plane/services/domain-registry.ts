const VALID_DOMAIN_ID_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

// In production, back this with a real DB.
// For now, use env-based mapping.
export function resolveDomainDb(domainId: string): string {
  if (!VALID_DOMAIN_ID_REGEX.test(domainId)) {
  throw new Error(`Invalid domain ID format: ${domainId}`);
  }

  const cs = process.env[`DOMAIN_${domainId.toUpperCase()}_DB`];
  if (!cs) throw new Error(`Missing DB for domain ${domainId}`);
  return cs;
}
