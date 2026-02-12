
import { GetServerSideProps } from 'next';
import { useState } from 'react';

import { AppShell } from '../../components/AppShell';
import { authFetch, apiUrl } from '../../lib/api-client';

export default function DomainDetail({ domain: initialDomain, themes }: Record<string, unknown>) {
  const [domain, setDomain] = useState(initialDomain);
  const [editMode, setEditMode] = useState(false);
  const [formData, setFormData] = useState({
    name: (domain as Record<string, unknown>).name || '',
    status: (domain as Record<string, unknown>).status || 'active',
    domainType: (domain as Record<string, unknown>).domainType || 'money',
  });
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  const handleUpdateDomain = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const response = await fetch(apiUrl(`domains/${(domain as Record<string, unknown>).id}`), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          name: formData.name,
          status: formData.status,
          domainType: formData.domainType,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Failed to update domain');
        setSubmitting(false);
        return;
      }

      // Update local state
      setDomain(prev => ({
        ...prev,
        name: formData.name,
        status: formData.status,
        domainType: formData.domainType,
      }));
      setEditMode(false);
    } catch (e) {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
  <AppShell>
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <h1>{(domain as Record<string, unknown>).name}</h1>
        <p>Status: {(domain as Record<string, unknown>).status}</p>
      </div>
      <button onClick={() => setEditMode(!editMode)}>
        {editMode ? 'Cancel' : 'Edit Domain'}
      </button>
    </div>

    {editMode && (
      <section style={{ border: '1px solid #ccc', padding: '20px', margin: '20px 0' }}>
        <h2>Edit Domain</h2>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        <form onSubmit={handleUpdateDomain}>
          <div style={{ marginBottom: '15px' }}>
            <label htmlFor="name">Domain Name:</label>
            <input
              id="name"
              type="text"
              name="name"
              value={formData.name}
              onChange={handleInputChange}
              required
              maxLength={253}
            />
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label htmlFor="status">Status:</label>
            <select name="status" value={formData.status} onChange={handleInputChange}>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
              <option value="pending">Pending</option>
              <option value="suspended">Suspended</option>
            </select>
          </div>

          <div style={{ marginBottom: '15px' }}>
            <label htmlFor="domainType">Domain Type:</label>
            <select name="domainType" value={formData.domainType} onChange={handleInputChange}>
              <option value="money">Money</option>
              <option value="brand">Brand</option>
              <option value="test">Test</option>
              <option value="redirect">Redirect</option>
            </select>
          </div>

          <button type="submit" disabled={submitting}>
            {submitting ? 'Updating...' : 'Save Changes'}
          </button>
        </form>
      </section>
    )}

    <section>
    <h2>Overview</h2>
    <pre>{JSON.stringify(domain, null, 2)}</pre>
    </section>

    <section>
    <h2>Theme</h2>
    <form>
      <select>
      {(themes as Record<string, unknown>[]).map((t: Record<string, unknown>) => (
        <option key={t.id} value={t.id}>{t.name}</option>
      ))}
      </select>
      <button type='submit'>Bind theme</button>
    </form>
    </section>

    <section>
    <h2>Deployment</h2>
    <p>
      Domains are deployed as one Vercel project per domain.
    </p>
    <button>Provision Vercel project</button>
    </section>

    <section>
    <h2>Buyer & Exit</h2>
    {/* H1-FIX: Removed broken buyerToken link — field not returned by GET /domains/:id */}
    <ul>
      <li><a href='/sell-ready'>Sell readiness</a></li>
    </ul>
    </section>
  </AppShell>
  );
}

export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const id = ctx.params?.['id'];

  const [domainRes, themesRes] = await Promise.all([
  authFetch(apiUrl(`domains/${id}`), { ctx }),
  authFetch(apiUrl('themes'), { ctx }),
  ]);

  const [domain, themes] = await Promise.all([
  domainRes.json(),
  themesRes.json(),
  ]);

  return { props: { domain, themes } };
};
