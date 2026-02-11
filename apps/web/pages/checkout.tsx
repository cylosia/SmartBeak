
import { useEffect } from 'react';
export default function Checkout() {
  useEffect(() => {
  fetch('/api/stripe/create-checkout-session', { method: 'POST' })
    .then(r => r.json())
    .then(d => {
    if (typeof window !== 'undefined') {
      window.location.href = d.url;
    }
    });
  }, []);

  return <p>Redirecting to secure checkout…</p>;
}
