import { useState } from 'react';
import type { GetServerSidePropsContext } from 'next';

import { AppShell } from '../../../../components/AppShell';
import { ContentAdvancedFilters } from '../../../../components/ContentAdvancedFilters';
import { ContentBulkReviewBar } from '../../../../components/ContentBulkReviewBar';
import { DomainTabs } from '../../../../components/DomainTabs';

interface ContentItem {
  id: string;
  title: string;
  type: string;
  status: string;
  primary_keyword: string | null;
  author: string | null;
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
        <a href={`/domains/${domainId}/content/new`}>➕ Create Content</a>
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
            <th>Primary Keyword</th>
            <th>Author</th>
          </tr>
        </thead>
        <tbody>
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
              <td>{c.type}</td>
              <td>{c.status}</td>
              <td>{c.primary_keyword || '—'}</td>
              <td>{c.author || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </AppShell>
  );
}

export async function getServerSideProps({ params }: GetServerSidePropsContext) {
  const id = params?.['id'];
  if (typeof id !== 'string') {
    return { notFound: true };
  }

  const content: ContentItem[] = [
    { id: '1', title: 'Best Wireless Headphones', type: 'Blog', status: 'Published', primary_keyword: 'wireless headphones', author: 'Jane Smith' },
    { id: '2', title: 'Noise Cancelling Guide', type: 'Web', status: 'Draft', primary_keyword: 'noise cancelling', author: 'Editorial Team' }
  ];

  return { props: { domainId: id, content } };
}
