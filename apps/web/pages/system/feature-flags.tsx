'use client';

import { useState, useEffect, useCallback } from 'react';
import { GetServerSideProps } from 'next';

import { AppShell } from '../../components/AppShell';
import { authFetch, apiUrl } from '../../lib/api-client';
import { fetchWithCsrf } from '../../lib/csrf';

interface FlagEntry {
  key: string;
  value: boolean;
  source: 'env' | 'database';
  updatedAt: string | null;
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid var(--border)',
  fontSize: 12,
  color: 'var(--text-muted)',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid var(--border)',
};

const badgeBase: React.CSSProperties = {
  display: 'inline-block',
  padding: '2px 8px',
  borderRadius: 4,
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase',
};

export default function FeatureFlags() {
  const [flags, setFlags] = useState<FlagEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState<string | null>(null);

  const fetchFlags = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch(apiUrl('admin/flags'), { credentials: 'include', signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: { flags: FlagEntry[] } = await res.json();
      setFlags(data.flags);
      setError('');
    } catch (err) {
      // M6 FIX: Ignore AbortError — it means the component unmounted before
      // the response arrived; calling setState on an unmounted component
      // produces a React warning and is a potential memory leak.
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Failed to fetch flags');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // M6 FIX: Create an AbortController so the in-flight request is cancelled
    // when the component unmounts, preventing setState on an unmounted component.
    const controller = new AbortController();
    void fetchFlags(controller.signal);
    return () => { controller.abort(); };
  }, [fetchFlags]);

  const handleToggle = async (key: string, newValue: boolean) => {
    // Optimistic update
    setFlags(prev => prev.map(f => f.key === key ? { ...f, value: newValue } : f));
    setSaving(key);

    try {
      const res = await fetchWithCsrf(apiUrl(`admin/flags/${encodeURIComponent(key)}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: newValue }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // Re-fetch to get updated timestamp
      void fetchFlags();
    } catch {
      // Revert on failure
      setFlags(prev => prev.map(f => f.key === key ? { ...f, value: !newValue } : f));
      setError(`Failed to update flag "${key}"`);
    } finally {
      setSaving(null);
    }
  };

  return (
    <AppShell>
      <h2>Feature Flags</h2>

      {error && <p style={{ color: 'var(--danger, red)', marginBottom: 16 }}>{error}</p>}

      {loading ? (
        <p>Loading flags...</p>
      ) : flags.length === 0 ? (
        <p style={{ color: 'var(--text-muted)' }}>No feature flags configured.</p>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Flag</th>
              <th style={{ ...thStyle, textAlign: 'center', width: 100 }}>Value</th>
              <th style={{ ...thStyle, textAlign: 'center', width: 100 }}>Source</th>
              <th style={{ ...thStyle, width: 180 }}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {flags.map(flag => (
              <tr key={flag.key}>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 13 }}>
                  {flag.key}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  {flag.source === 'env' ? (
                    <span
                      style={{
                        ...badgeBase,
                        background: flag.value ? 'var(--accent, #0d6efd)' : 'var(--panel)',
                        color: flag.value ? '#fff' : 'var(--text-muted)',
                        border: flag.value ? 'none' : '1px solid var(--border)',
                      }}
                      title="Set via environment variable (read-only)"
                    >
                      {flag.value ? 'ON' : 'OFF'}
                    </span>
                  ) : (
                    <label aria-label={`Toggle ${flag.key}`} style={{ cursor: saving === flag.key ? 'wait' : 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={flag.value}
                        onChange={e => void handleToggle(flag.key, e.target.checked)}
                        disabled={saving === flag.key}
                        style={{ cursor: 'inherit' }}
                      />
                    </label>
                  )}
                </td>
                <td style={{ ...tdStyle, textAlign: 'center' }}>
                  <span
                    style={{
                      ...badgeBase,
                      background: flag.source === 'env' ? 'var(--panel)' : 'var(--accent, #0d6efd)',
                      color: flag.source === 'env' ? 'var(--text-muted)' : '#fff',
                      border: flag.source === 'env' ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    {flag.source}
                  </span>
                </td>
                <td style={{ ...tdStyle, color: 'var(--text-muted)', fontSize: 12 }}>
                  {flag.updatedAt ? new Date(flag.updatedAt).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  try {
    await authFetch(apiUrl('system/health'), { ctx });
    return { props: {} };
  } catch {
    return { redirect: { destination: '/login', permanent: false } };
  }
};
