import { useState, useEffect, useCallback, useRef } from 'react';
import { GetServerSideProps } from 'next';
import { getAuth } from '@clerk/nextjs/server';

import { AppShell } from '../../components/AppShell';
import { authFetch, apiUrl } from '../../lib/api-client';
import { fetchWithCsrf } from '../../lib/csrf';

interface CacheStats {
  l1Hits: number;
  l1Misses: number;
  l2Hits: number;
  l2Misses: number;
  totalRequests: number;
  l1HitRate: number;
  l2HitRate: number;
  overallHitRate: number;
  inFlightRequests: number;
  inFlightCleaned: number;
  inFlightTimeouts: number;
}

interface CacheStatsResponse {
  stats: CacheStats;
  l1Size: number;
  memory: { heapUsed: number; heapTotal: number; external: number; rss: number };
}

interface CacheKeysResponse {
  keys: string[];
  total: number;
  offset: number;
  limit: number;
}

function formatBytes(bytes: number): string {
  const sizes = ['B', 'KB', 'MB', 'GB'];
  if (bytes === 0) return '0 B';
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${sizes[i]}`;
}

function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

const cardStyle: React.CSSProperties = {
  background: 'var(--panel)',
  border: '1px solid var(--border)',
  borderRadius: 8,
  padding: 16,
};

const labelStyle: React.CSSProperties = {
  color: 'var(--text-muted)',
  fontSize: 12,
  marginBottom: 4,
};

const valueStyle: React.CSSProperties = {
  fontSize: 24,
  fontWeight: 'bold',
  color: 'var(--text)',
};

const btnStyle: React.CSSProperties = {
  padding: '6px 14px',
  border: '1px solid var(--border)',
  borderRadius: 6,
  background: 'var(--panel)',
  color: 'var(--text)',
  cursor: 'pointer',
  fontSize: 13,
};

const dangerBtnStyle: React.CSSProperties = {
  ...btnStyle,
  borderColor: 'var(--danger, #dc3545)',
  color: 'var(--danger, #dc3545)',
};

export default function SystemCache() {
  const [stats, setStats] = useState<CacheStatsResponse | null>(null);
  const [keys, setKeys] = useState<string[]>([]);
  const [keyTotal, setKeyTotal] = useState(0);
  const [searchPattern, setSearchPattern] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const res = await fetch(apiUrl('admin/cache/stats'), { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: CacheStatsResponse = await res.json();
      setStats(data);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch stats');
    }
  }, []);

  const fetchKeys = useCallback(async (pattern?: string) => {
    try {
      const params = new URLSearchParams({ limit: '100', offset: '0' });
      if (pattern) params.set('pattern', pattern);
      const res = await fetch(apiUrl(`admin/cache/keys?${params}`), { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: CacheKeysResponse = await res.json();
      setKeys(data.keys);
      setKeyTotal(data.total);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch keys');
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.all([fetchStats(), fetchKeys()]);
    setLoading(false);
  }, [fetchStats, fetchKeys]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => {
        void fetchStats();
      }, 5000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchStats]);

  const handleDeleteKey = async (key: string) => {
    if (!window.confirm(`Delete cache key "${key}"?`)) return;
    try {
      const res = await fetchWithCsrf(apiUrl(`admin/cache/keys/${encodeURIComponent(key)}`), {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setKeys(prev => prev.filter(k => k !== key));
      setKeyTotal(prev => prev - 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete key');
    }
  };

  const handleClear = async (tier: 'l1' | 'l2' | 'all') => {
    const tierLabel = tier === 'all' ? 'ALL caches' : `${tier.toUpperCase()} cache`;
    if (!window.confirm(`Clear ${tierLabel}? This cannot be undone.`)) return;
    try {
      const res = await fetchWithCsrf(apiUrl('admin/cache/clear'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      void loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear cache');
    }
  };

  const handleResetStats = async () => {
    if (!window.confirm('Reset all cache statistics?')) return;
    try {
      const res = await fetchWithCsrf(apiUrl('admin/cache/stats/reset'), {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      void fetchStats();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset stats');
    }
  };

  const handleSearch = () => {
    void fetchKeys(searchPattern || undefined);
  };

  return (
    <AppShell>
      <h2>Cache Inspector</h2>

      {error && <p style={{ color: 'var(--danger, red)', marginBottom: 16 }}>{error}</p>}

      {loading && !stats ? (
        <p>Loading cache data...</p>
      ) : stats ? (
        <>
          {/* Stats Dashboard */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))',
            gap: 12,
            marginBottom: 24,
          }}>
            <div style={cardStyle}>
              <div style={labelStyle}>L1 Hit Rate</div>
              <div style={valueStyle}>{formatRate(stats.stats.l1HitRate)}</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>L2 Hit Rate</div>
              <div style={valueStyle}>{formatRate(stats.stats.l2HitRate)}</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Overall Hit Rate</div>
              <div style={valueStyle}>{formatRate(stats.stats.overallHitRate)}</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Total Requests</div>
              <div style={valueStyle}>{stats.stats.totalRequests.toLocaleString()}</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>L1 Entries</div>
              <div style={valueStyle}>{stats.l1Size.toLocaleString()}</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>In-Flight</div>
              <div style={valueStyle}>{stats.stats.inFlightRequests}</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>In-Flight Cleaned</div>
              <div style={valueStyle}>{stats.stats.inFlightCleaned}</div>
            </div>
            <div style={cardStyle}>
              <div style={labelStyle}>Heap Usage</div>
              <div style={{ ...valueStyle, fontSize: 18 }}>
                {formatBytes(stats.memory.heapUsed)} / {formatBytes(stats.memory.heapTotal)}
              </div>
            </div>
          </div>

          {/* Action Bar */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 24, flexWrap: 'wrap', alignItems: 'center' }}>
            <button style={dangerBtnStyle} onClick={() => void handleClear('l1')}>Clear L1</button>
            <button style={dangerBtnStyle} onClick={() => void handleClear('l2')}>Clear L2</button>
            <button style={dangerBtnStyle} onClick={() => void handleClear('all')}>Clear All</button>
            <button style={btnStyle} onClick={() => void handleResetStats()}>Reset Stats</button>
            <button style={btnStyle} onClick={() => void loadAll()}>Refresh</button>
            <label style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--text-muted)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={autoRefresh}
                onChange={e => setAutoRefresh(e.target.checked)}
                style={{ marginRight: 6 }}
              />
              Auto-refresh (5s)
            </label>
          </div>

          {/* Key Browser */}
          <section>
            <h3 style={{ marginBottom: 12 }}>Cache Keys ({keyTotal})</h3>
            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              <input
                type="text"
                placeholder="Search pattern (e.g. user:*)"
                value={searchPattern}
                onChange={e => setSearchPattern(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSearch(); }}
                style={{
                  padding: '6px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 6,
                  background: 'var(--panel)',
                  color: 'var(--text)',
                  width: 300,
                  fontSize: 13,
                }}
              />
              <button style={btnStyle} onClick={handleSearch}>Search</button>
            </div>

            {keys.length === 0 ? (
              <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No cache keys found.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', padding: '8px 12px', borderBottom: '2px solid var(--border)', fontSize: 12, color: 'var(--text-muted)' }}>Key</th>
                    <th style={{ textAlign: 'right', padding: '8px 12px', borderBottom: '2px solid var(--border)', fontSize: 12, color: 'var(--text-muted)', width: 80 }}>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map(key => (
                    <tr key={key} style={{ borderBottom: '1px solid var(--border)' }}>
                      <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 13, wordBreak: 'break-all' }}>{key}</td>
                      <td style={{ padding: '6px 12px', textAlign: 'right' }}>
                        <button
                          onClick={() => void handleDeleteKey(key)}
                          style={{
                            color: 'var(--danger, #dc3545)',
                            background: 'none',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: 12,
                            textDecoration: 'underline',
                          }}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </>
      ) : null}
    </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const { userId } = getAuth(ctx.req);
  if (!userId) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  try {
    const { getPoolInstance } = await import('../../lib/db');
    const pool = await getPoolInstance();
    const { rows } = await pool.query(
      `SELECT m.role FROM memberships m
       JOIN users u ON u.id = m.user_id
       WHERE u.clerk_id = $1 AND m.role IN ('owner', 'admin')
       LIMIT 1`,
      [userId]
    );
    if (rows.length === 0) {
      return { redirect: { destination: '/dashboard', permanent: false } };
    }
    return { props: {} };
  } catch {
    return { redirect: { destination: '/login', permanent: false } };
  }
};
