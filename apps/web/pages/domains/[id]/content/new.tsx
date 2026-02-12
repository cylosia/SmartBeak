import { useState, FormEvent } from 'react';
import type { GetServerSidePropsContext } from 'next';
import { useRouter } from 'next/router';

import { AppShell } from '../../../../components/AppShell';
import { DomainTabs } from '../../../../components/DomainTabs';
import { apiUrl } from '../../../../lib/api-client';

interface NewContentProps {
  domainId: string;
}

export default function NewContent({ domainId }: NewContentProps) {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [contentType, setContentType] = useState('article');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const res = await fetch(apiUrl('content'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ domainId, title, contentType }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create content');
        return;
      }

      const { item } = await res.json();
      router.push(`/domains/${domainId}/content/${item.id}`);
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='content' />

      <h2>Create Content</h2>
      <p>Content is created as a draft and requires human approval to publish.</p>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <form onSubmit={handleSubmit}>
        <label>
          Title<br />
          <input
            type='text'
            value={title}
            onChange={e => setTitle(e.target.value)}
            required
          />
        </label><br /><br />

        <label>
          Content Type<br />
          {/* C8-FIX: Aligned option values to API enum */}
          <select value={contentType} onChange={e => setContentType(e.target.value)}>
            <option value='article'>Article</option>
            <option value='page'>Page</option>
            <option value='product'>Product</option>
            <option value='review'>Review</option>
            <option value='guide'>Guide</option>
            <option value='post'>Post</option>
            <option value='video'>Video</option>
            <option value='image'>Image</option>
          </select>
        </label><br /><br />

        <button type='submit' disabled={submitting}>
          {submitting ? 'Creating...' : 'Create Draft'}
        </button>
      </form>
    </AppShell>
  );
}

export async function getServerSideProps({ params }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }
  return { props: { domainId: id } };
}
