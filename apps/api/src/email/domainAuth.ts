
import { DomainAuthError } from '../errors';
import dns from 'dns/promises';

export type DomainAuthStatus = {
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
};

// M08-FIX: Implement actual DNS checks instead of always throwing
export async function checkDomainAuth(domain: string): Promise<DomainAuthStatus> {

  if (!domain || typeof domain !== 'string') {
  throw new DomainAuthError('Valid domain string is required');
  }

  // Validate domain format (basic check) — validate labels separately to avoid ReDoS
  const domainLabels = domain.split('.');
  const tldRegex = /^[a-zA-Z]{2,}$/;
  const isValidLabel = (l: string) =>
    l.length >= 1 && l.length <= 63
    && /^[a-zA-Z0-9]/.test(l) && /[a-zA-Z0-9]$/.test(l)
    && /^[a-zA-Z0-9-]+$/.test(l);
  const isValidDomain = domainLabels.length >= 2
    && domainLabels.slice(0, -1).every(isValidLabel)
    && tldRegex.test(domainLabels[domainLabels.length - 1]!);
  if (!isValidDomain) {
  throw new DomainAuthError(`Invalid domain format: ${domain}`);
  }

  const status: DomainAuthStatus = { spf: false, dkim: false, dmarc: false };

  try {
  const txtRecords = await dns.resolveTxt(domain);
  const flat = txtRecords.flat();
  status.spf = flat.some(r => r.startsWith('v=spf1'));
  } catch {
  // No TXT records or DNS failure — SPF not found
  }

  try {
  const dmarcRecords = await dns.resolveTxt(`_dmarc.${domain}`);
  const flat = dmarcRecords.flat();
  status.dmarc = flat.some(r => r.startsWith('v=DMARC1'));
  } catch {
  // No DMARC record
  }

  try {
  // Check for default DKIM selector
  const dkimRecords = await dns.resolveTxt(`default._domainkey.${domain}`);
  const flat = dkimRecords.flat();
  status.dkim = flat.some(r => r.includes('v=DKIM1'));
  } catch {
  // No DKIM record at default selector
  }

  return status;
}
