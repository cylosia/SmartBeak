
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

import { authFetch } from '../lib/api-client';

/**
 * Checkout page — creates a Stripe Checkout session via the Fastify
 * control-plane API and redirects the browser to the Stripe-hosted page.
 *
 * Expects ?priceId=price_xxx in the URL query string.
 */
export default function Checkout() {
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;

    let cancelled = false;

    async function createSession() {
      try {
        const priceId = router.query['priceId'];
        if (!priceId || typeof priceId !== 'string' || !priceId.startsWith('price_')) {
          throw new Error('Missing or invalid priceId query parameter');
        }

        const res = await authFetch('billing/checkout', {
          method: 'POST',
          body: JSON.stringify({ priceId }),
        });

        const data = await res.json();

        if (cancelled) return;

        // Validate that the URL is a Stripe checkout URL before redirecting
        if (typeof data.url === 'string' && data.url.startsWith('https://checkout.stripe.com/')) {
          window.location.href = data.url;
        } else {
          throw new Error('Invalid checkout URL received');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to create checkout session');
        }
      }
    }

    void createSession();
    return () => { cancelled = true; };
  }, [router.isReady, router.query]);

  if (error) {
    return <p>Checkout error: {error}. Please try again or contact support.</p>;
  }

  return <p>Redirecting to secure checkout…</p>;
}
