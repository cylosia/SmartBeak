
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

/**
 * P0-2 FIX: Previously this page had:
 * - No credentials/cookies sent with fetch (broken auth in cross-origin)
 * - No error handling (blind redirect to whatever server returns, including error HTML)
 * - No CSRF token
 * - Floating promise (fetch chain not caught)
 * - No URL validation on redirect target
 */
export default function Checkout() {
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => {
  let cancelled = false;

  async function createSession() {
    // P1-021 FIX: Read priceId from the URL query parameter.
    // Previously the POST body was empty — the server always returned 400
    // because priceId is required, making the checkout page non-functional.
    const priceId = typeof router.query['priceId'] === 'string'
      ? router.query['priceId']
      : null;

    if (!priceId) {
      setError('No plan selected. Please return to the pricing page and select a plan.');
      return;
    }

    try {
    const res = await fetch('/api/stripe/create-checkout-session', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ priceId }),
    });

    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Checkout failed (${res.status})`);
    }

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
  }, []);

  if (error) {
  return <p>Checkout error: {error}. Please try again or contact support.</p>;
  }

  return <p>Redirecting to secure checkout…</p>;
}
