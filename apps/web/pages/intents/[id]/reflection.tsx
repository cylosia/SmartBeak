
import { useState } from 'react';
import { useRouter } from 'next/router';
import { AppShell } from '../../../components/AppShell';
import { apiUrl, authFetch } from '../../../lib/api-client';

export default function Reflection() {
  const router = useRouter();
  const { id } = router.query;
  const [reflection, setReflection] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    if (!id || typeof id !== 'string') return;
    setSaving(true);
    setError(null);
    try {
      const res = await authFetch(apiUrl(`/intents/${id}/reflection`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reflection }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data['error'] ?? `Request failed: ${res.status}`);
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save reflection');
    } finally {
      setSaving(false);
    }
  };

  return (
    <AppShell>
      <h1>Decision Reflection</h1>
      <textarea
        placeholder='Would we do this again?'
        value={reflection}
        onChange={(e) => {
          setReflection(e.target.value);
          setSaved(false);
        }}
        disabled={saving}
      />
      <br />
      {error && <p role='alert' style={{ color: 'red' }}>{error}</p>}
      {saved && <p role='status'>Reflection saved.</p>}
      <button onClick={() => { void handleSave(); }} disabled={saving || !reflection.trim()}>
        {saving ? 'Saving\u2026' : 'Save Reflection'}
      </button>
    </AppShell>
  );
}
