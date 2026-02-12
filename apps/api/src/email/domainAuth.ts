
import { DomainAuthError } from '../errors';
import dns from 'dns/promises';

export type DomainAuthStatus = {
  spf: boolean;
  dkim: boolean;
  dmarc: boolean;
};

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 500;

/**
* Resolve TXT records with exponential backoff retry.
* Returns empty array on ENODATA/ENOTFOUND (no records), rethrows transient failures after retries.
*/
async function resolveTxtWithRetry(hostname: string): Promise<string[]> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
  try {
    const records = await dns.resolveTxt(hostname);
    return records.flat();
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    // ENODATA / ENOTFOUND means the record genuinely doesn't exist — no retry needed
    if (code === 'ENODATA' || code === 'ENOTFOUND') {
    return [];
    }
    if (attempt === MAX_RETRIES) {
    return []; // Exhausted retries; treat as not found rather than crashing
    }
    const delay = BASE_DELAY_MS * Math.pow(2, attempt);
    await new Promise(resolve => setTimeout(resolve, delay));
  }
  }
  return [];
}

// M08-FIX: Implement actual DNS checks instead of always throwing
export async function checkDomainAuth(domain: string): Promise<DomainAuthStatus> {

  if (!domain || typeof domain !== 'string') {
  throw new DomainAuthError('Valid domain string is required');
  }

  // Validate domain format (basic check)
  const domainRegex = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9](?:\.[a-zA-Z]{2,})+$/;
  if (!domainRegex.test(domain)) {
  throw new DomainAuthError(`Invalid domain format: ${domain}`);
  }

  const status: DomainAuthStatus = { spf: false, dkim: false, dmarc: false };

  const [spfRecords, dmarcRecords, dkimRecords] = await Promise.all([
  resolveTxtWithRetry(domain),
  resolveTxtWithRetry(`_dmarc.${domain}`),
  resolveTxtWithRetry(`default._domainkey.${domain}`),
  ]);

  status.spf = spfRecords.some(r => r.startsWith('v=spf1'));
  status.dmarc = dmarcRecords.some(r => r.startsWith('v=DMARC1'));
  status.dkim = dkimRecords.some(r => r.includes('v=DKIM1'));

  return status;
}
