import { useState } from 'react';
import type { GetServerSidePropsContext } from 'next';

import { AppShell } from '../../../../components/AppShell';
import { ContentAdvancedFilters } from '../../../../components/ContentAdvancedFilters';
import { ContentBulkReviewBar } from '../../../../components/ContentBulkReviewBar';
import { DomainTabs } from '../../../../components/DomainTabs';
import { authFetch, apiUrl } from '../../../../lib/api-client';

// H5-FIX: Aligned interface fields to match API response shape
interface ContentItem {
  id: string;
  title: string;
  contentType: string;
  status: string;
  domainId: string;
  domainName: string | null;
  createdAt: string;
  updatedAt: string;
}

interface ContentIndexProps {
  domainId: string;
  content: ContentItem[];
}

export default function ContentIndex({ domainId, content }: ContentIndexProps) {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (id: string) => {
    setSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id]);
  };

  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='content' />

      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Content</h2>
        <a href={`/domains/${domainId}/content/new`}>+ Create Content</a>
      </header>

      <ContentAdvancedFilters onFilter={() => {}} />
      <ContentBulkReviewBar selected={selected} />

      <table style={{ width: '100%' }}>
        <thead>
          <tr>
            <th></th>
            <th>Title</th>
            <th>Type</th>
            <th>Status</th>
            <th>Updated</th>
          </tr>
        </thead>
        <tbody>
          {content.length === 0 && (
            <tr><td colSpan={5}>No content yet. Create your first piece of content.</td></tr>
          )}
          {content.map((c) => (
            <tr key={c.id}>
              <td>
                <input
                  type='checkbox'
                  checked={selected.includes(c.id)}
                  onChange={() => toggle(c.id)}
                />
              </td>
              <td>
                <a href={`/domains/${domainId}/content/${c.id}`}>{c.title}</a>
              </td>
              <td>{c.contentType}</td>
              <td>{c.status}</td>
              <td>{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </AppShell>
  );
}

// C9-FIX: Replaced hardcoded mock data with actual API fetch
export async function getServerSideProps({ params, req }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }

  try {
    const res = await authFetch(apiUrl(`content?domainId=${id}`), { ctx: { req } });
    const json = await res.json();
    const content = json.data || [];
    return { props: { domainId: id, content } };
  } catch {
    return { props: { domainId: id, content: [] } };
  }
}
