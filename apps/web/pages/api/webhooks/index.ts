import type { NextApiRequest, NextApiResponse } from 'next';

/**
* Webhook Handler Router
* Routes incoming webhooks to appropriate handlers
*

* Each handler (stripe.ts, clerk.ts) performs its own signature verification
* based on provider-specific requirements.
*/

// Webhook handler registry - lazy loaded
const handlerCache: Record<string, (req: NextApiRequest, res: NextApiResponse) => Promise<void>> = {};

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
    default:
    return null;
  }
  } catch (error) {
  console.error(`[Webhook] Failed to load handler for ${provider}:`, error);
  return null as unknown as (req: NextApiRequest, res: NextApiResponse) => Promise<void> | null;
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
  console.error(`[Webhook] ${provider} error:`, err);

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
