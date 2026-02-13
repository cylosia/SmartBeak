
import { useState, FormEvent } from 'react';
import { useRouter } from 'next/router';

import { AppShell } from '../../components/AppShell';
import { apiUrl } from '../../lib/api-client';
import { fetchWithCsrf } from '../../lib/csrf';

export default function NewDomain() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [domainType, setDomainType] = useState('money');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      // P1-FIX: Use fetchWithCsrf to include X-CSRF-Token header
      const res = await fetchWithCsrf(apiUrl('domains'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name, domainType }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create domain');
        return;
      }

      const domain = await res.json();
      void router.push(`/domains/${domain.id}`);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
  <AppShell>
    <h1>Add Domain</h1>
    <p>
    Adding a domain creates a new asset boundary in ACP.
    Publishing and deployment are separate steps.
    </p>

    {error && <p style={{ color: 'red' }}>{error}</p>}

    <form onSubmit={(e) => void handleSubmit(e)}>
    <label>
      Domain name<br />
      <input
        type='text'
        placeholder='example.com'
        value={name}
        onChange={e => setName(e.target.value)}
        required
      />
    </label><br /><br />

    <label>
      Domain type<br />
      {/* C7-FIX: Aligned option values to API enum: money, brand, test, redirect */}
      <select value={domainType} onChange={e => setDomainType(e.target.value)}>
      <option value='money'>Money</option>
      <option value='brand'>Brand</option>
      <option value='test'>Test</option>
      <option value='redirect'>Redirect</option>
      </select>
    </label><br /><br />

    <button type='submit' disabled={submitting}>
      {submitting ? 'Creating...' : 'Create domain'}
    </button>
    </form>
  </AppShell>
  );
}
