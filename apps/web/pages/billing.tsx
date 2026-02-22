import { useState, useCallback } from 'react';

import { AppShell } from '../components/AppShell';
import { authFetch } from '../lib/api-client';

/**
 * Billing page — opens the Stripe Customer Portal via the Fastify
 * control-plane API so users can manage their subscription.
 */
export default function Billing() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openPortal = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // Server looks up the Stripe customer from the authenticated org
      const res = await authFetch('billing/portal', {
        method: 'POST',
        body: JSON.stringify({}),
      });

      const data = await res.json();

      if (typeof data.url === 'string') {
        window.location.href = data.url;
      } else {
        throw new Error('Failed to open billing portal');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open billing portal');
      setLoading(false);
    }
  }, []);

  return (
    <AppShell>
      <h1>Billing</h1>
      <p>Manage your subscription via the Stripe customer portal.</p>
      {error && <p style={{ color: 'red' }}>{error}</p>}
      <button onClick={() => void openPortal()} disabled={loading}>
        {loading ? 'Opening portal…' : 'Open billing portal'}
      </button>
    </AppShell>
  );
}
