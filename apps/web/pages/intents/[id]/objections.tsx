
import React, { useState } from 'react';
import { useRouter } from 'next/router';
import { AppShell } from '../../../components/AppShell';

export default function Objections() {
  const router = useRouter();
  const intentId = router.query['id'] as string | undefined;
  const [objection, setObjection] = useState('');
  const [status, setStatus] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');

  // P2-11: Handler wired to button click; reads intentId from route param;
  // manages controlled textarea state.
  async function handleSubmit() {
    if (!objection.trim() || !intentId) return;
    setStatus('submitting');
    try {
      const res = await fetch(`/api/intents/${intentId}/objections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ objection: objection.trim() }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      setObjection('');
      setStatus('success');
    } catch {
      setStatus('error');
    }
  }

  return (
    <AppShell>
      <h1>Decision Objections</h1>
      <label htmlFor="objection-input">Objection or concern</label>
      <textarea
        id="objection-input"
        value={objection}
        onChange={(e: { target: { value: string } }) => { setObjection(e.target.value); setStatus('idle'); }}
        placeholder="Record an objection or concern"
      />
      <br />
      <button type="button" onClick={() => { void handleSubmit(); }} disabled={status === 'submitting'}>
        {status === 'submitting' ? 'Submitting…' : 'Submit Objection'}
      </button>
      {status === 'success' && <p>Objection recorded successfully.</p>}
      {status === 'error' && <p style={{ color: 'red' }}>Failed to submit. Please try again.</p>}
    </AppShell>
  );
}
