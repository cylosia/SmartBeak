
import { useState } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '@clerk/nextjs';
import { GetServerSideProps } from 'next';
import { getAuth } from '@clerk/nextjs/server';
import { AppShell } from '../../../components/AppShell';

// SECURITY FIX (OBJ-1): Guard is applied at two levels:
// 1. getServerSideProps performs server-side auth check — unauthenticated users
//    are redirected to /login before any HTML is served, preventing information
//    disclosure and avoiding wasted client-side renders.
// 2. useAuth() in the component provides an additional client-side guard for
//    SPA navigations that bypass getServerSideProps (pushState transitions).
export const getServerSideProps: GetServerSideProps = async (ctx) => {
  const { userId } = getAuth(ctx.req);
  if (!userId) {
    return { redirect: { destination: '/login', permanent: false } };
  }
  return { props: {} };
};

const MAX_OBJECTION_LENGTH = 2000;

export default function Objections() {
  // SECURITY FIX (OBJ-3): Read the intent ID from the dynamic route segment so
  // that submitted objections can be associated with the correct intent.
  const router = useRouter();
  const { id } = router.query;
  // SECURITY FIX (OBJ-1): Client-side guard for SPA navigations.
  const { getToken } = useAuth();

  const [text, setText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!text.trim()) {
      setError('Please enter an objection or concern.');
      return;
    }
    if (!id || typeof id !== 'string') {
      setError('Invalid intent ID.');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const token = await getToken();
      // FIX (OBJ-5): Only send Authorization header when a token is actually
      // present.  `token ?? ''` would send `Bearer ` (empty token) when
      // getToken() returns null, causing the API to reject with 401 while
      // unnecessarily consuming rate-limit quota for the invalid attempt.
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      const res = await fetch(`/api/intents/${encodeURIComponent(id)}/objections`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ text: text.trim() }),
      });

      if (!res.ok) {
        const body: unknown = await res.json().catch(() => ({}));
        const msg =
          typeof body === 'object' &&
          body !== null &&
          'message' in body &&
          typeof (body as Record<string, unknown>)['message'] === 'string'
            ? (body as Record<string, string>)['message']
            : 'Failed to submit objection. Please try again.';
        setError(msg);
        return;
      }

      setSuccess(true);
      setText('');
    } catch {
      setError('An unexpected error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <h1>Decision Objections</h1>
      {/* FIX (OBJ-6): role="status" and role="alert" create aria-live regions so
          screen readers announce state changes on SPA navigations.  role="status"
          (polite) is appropriate for success messages; role="alert" (assertive) is
          appropriate for errors that require immediate attention. */}
      {success && <p role="status" style={{ color: 'green' }}>Objection submitted successfully.</p>}
      {error && <p role="alert" style={{ color: 'red' }}>{error}</p>}
      <form onSubmit={handleSubmit}>
        {/* ACCESSIBILITY FIX (OBJ-4): Associate label with textarea via htmlFor/id. */}
        <label htmlFor="objection-text">
          Objection or concern
        </label>
        {/* ACCESSIBILITY FIX (OBJ-2): Use CSS margin instead of <br /> for spacing. */}
        <div style={{ marginTop: 8 }}>
          <textarea
            id="objection-text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Record an objection or concern"
            maxLength={MAX_OBJECTION_LENGTH}
            disabled={submitting}
            rows={5}
            style={{ width: '100%' }}
          />
        </div>
        <div style={{ marginTop: 8 }}>
          <button type="submit" disabled={submitting || !text.trim()}>
            {submitting ? 'Submitting\u2026' : 'Submit Objection'}
          </button>
        </div>
      </form>
    </AppShell>
  );
}
