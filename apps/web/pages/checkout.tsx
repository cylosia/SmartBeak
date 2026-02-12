
import { useEffect, useState } from 'react';

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

  useEffect(() => {
  let cancelled = false;

  async function createSession() {
    try {
    const res = await fetch('/api/stripe/create-checkout-session', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
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

  createSession();
  return () => { cancelled = true; };
  }, []);

  if (error) {
  return <p>Checkout error: {error}. Please try again or contact support.</p>;
  }

  return <p>Redirecting to secure checkout…</p>;
}
