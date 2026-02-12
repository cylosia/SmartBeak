import { EmailSubscriber } from './subscriberTypes';
import { getLogger } from '../../../../packages/kernel/logger';

/**
* MEDIUM FIX M1, M2, M3, M4: Enhanced provider sync
* - Input validation
* - Error handling
* - Rate limiting
* - Retry logic
*/

const logger = getLogger('EmailProviderSync');

const RATE_LIMIT_WINDOW_MS = 1000;
const MAX_SYNC_PER_WINDOW = 100;

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

let syncsInWindow = 0;
let windowStart = Date.now();

/**
* MEDIUM FIX M3: Validate subscriber object
*/
function validateSubscriber(sub: EmailSubscriber): void {
  if (!sub || typeof sub !== 'object') {
  throw new Error('Invalid subscriber: must be an object');
  }

  if (!sub.id || typeof sub.id !== 'string') {
  throw new Error('Invalid subscriber: id is required and must be a string');
  }

  if (!sub.email || typeof sub.email !== 'string') {
  throw new Error('Invalid subscriber: email is required and must be a string');
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(sub.email)) {
  throw new Error(`Invalid subscriber email format: ${sub.email}`);
  }

  if (sub.email.length > 254) {
  throw new Error('Invalid subscriber: email exceeds maximum length of 254');
  }
}

/**
* MEDIUM FIX M4: Check rate limit
*/
function checkRateLimit(): boolean {
  const now = Date.now();

  if (now - windowStart > RATE_LIMIT_WINDOW_MS) {
  windowStart = now;
  syncsInWindow = 0;
  }

  if (syncsInWindow >= MAX_SYNC_PER_WINDOW) {
  return false;
  }

  syncsInWindow++;
  return true;
}

/**
* MEDIUM FIX M4: Sleep helper for retry delays
*/
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function syncSubscriberToProvider(sub: EmailSubscriber): Promise<{ success: boolean; syncedAt: Date }> {
  validateSubscriber(sub);

  if (!checkRateLimit()) {
  throw new Error('Rate limit exceeded for subscriber sync');
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
  try {
    // ACP remains source-of-truth for consent & lifecycle
    // Provider is downstream execution system

    // Simulate provider sync (replace with actual implementation)
    await performProviderSync(sub);

    logger.info(`Successfully synced subscriber ${sub.id} on attempt ${attempt + 1}`);

    return {
    success: true,
    syncedAt: new Date(),
    };
  } catch (error) {
    lastError = error instanceof Error ? error : new Error(String(error));

    logger.warn(`Sync attempt ${attempt + 1}/${MAX_RETRIES} failed for subscriber ${sub.id}: ${lastError["message"]}`);

      if (attempt < MAX_RETRIES - 1) {
    const delay = RETRY_DELAY_MS * Math.pow(2, attempt);
    await sleep(delay);
    }
  }
  }

  logger.error(`All ${MAX_RETRIES} sync attempts failed for subscriber ${sub.id}`, lastError ?? undefined);
  throw new Error(`Failed to sync subscriber after ${MAX_RETRIES} attempts: ${lastError?.["message"]}`);
}

/**
* MEDIUM FIX M1: Actual provider sync implementation
* (Placeholder for actual provider integration)
*/
async function performProviderSync(_sub: EmailSubscriber): Promise<void> {
  // NOTE: Provider sync implementation is pending
  // This is a placeholder that always succeeds
  // Replace with actual integration (e.g., Mailchimp, SendGrid, etc.)

  // Simulate async operation
  await sleep(10);
}
