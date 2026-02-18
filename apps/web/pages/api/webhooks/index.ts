import type { NextApiRequest, NextApiResponse } from 'next';

import { getLogger } from '@kernel/logger';

const logger = getLogger('webhook');

/**
* Webhook Handler Router
* Routes incoming webhooks to appropriate handlers
*

* Each handler (stripe.ts, clerk.ts) performs its own signature verification
* based on provider-specific requirements.
*/

// Webhook handler registry - lazy loaded.
// Object.create(null) produces a prototype-free object, preventing prototype
// pollution if a crafted provider string like "__proto__" or "constructor" is
// passed — such keys would otherwise access Object.prototype properties instead
// of stored handlers, causing crashes or unexpected behaviour.
const handlerCache = Object.create(null) as Record<string, (req: NextApiRequest, res: NextApiResponse) => Promise<void>>;

async function loadHandler(provider: string): Promise<((req: NextApiRequest, res: NextApiResponse) => Promise<void>) | null> {
  if (handlerCache[provider]) {
  return handlerCache[provider];
  }

  try {
  // Dynamic import for ESM compatibility
  switch (provider) {
    case 'stripe': {
    const stripeModule = await import('./stripe');
    const handler = stripeModule.default as (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
    handlerCache[provider] = handler;
    return handler;
    }
    case 'clerk': {
    const clerkModule = await import('./clerk');
    const handler = clerkModule.default as unknown as (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
    handlerCache[provider] = handler;
    return handler;
    }
    case 'paddle': {
    const paddleModule = await import('./paddle');
    const handler = paddleModule.default as (req: NextApiRequest, res: NextApiResponse) => Promise<void>;
    handlerCache[provider] = handler;
    return handler;
    }
    default:
    return null;
  }
  } catch (error) {
  logger.error('Failed to load handler', error instanceof Error ? error : undefined, { provider, error: String(error) });
  return null;
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
  return res.status(405).json({ error: 'Method not allowed' });
  }

  const { provider } = req.query;

  if (!provider || typeof provider !== 'string') {
  return res.status(400).json({ error: 'Provider required' });
  }

  const handler = await loadHandler(provider);

  if (!handler) {
  return res.status(404).json({ error: `Unknown provider: ${provider}` });
  }

  try {
  await handler(req, res);
  return;
  } catch (error: unknown) {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error('Provider error', err, { provider });

  const errorMessage = process.env['NODE_ENV'] === 'development'
    ? err.message
    : 'Webhook processing failed';
  return res.status(400).json({ error: errorMessage });
  }
}

export const config = {
  api: {
  bodyParser: false,
  },
};
