import type { GetServerSidePropsContext } from 'next';
import { useState } from 'react';

import { AppShell } from '../../../../components/AppShell';
import { DomainTabs } from '../../../../components/DomainTabs';
import { ImageEditor } from '../../../../components/editors/ImageEditor';
import { VideoEditor } from '../../../../components/editors/VideoEditor';
import { WebEditor } from '../../../../components/editors/WebEditor';
import { authFetch, apiUrl } from '../../../../lib/api-client';

interface ContentDetailProps {
  domainId: string;
  contentId: string;
  contentType: string;
}

const PUBLISHING_TARGETS = [
  { id: 'facebook', label: 'Facebook' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'twitter', label: 'Twitter' },
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'email', label: 'Email' },
];

export default function ContentDetail({ domainId, contentId: _contentId, contentType }: ContentDetailProps) {
  const [publishMode, setPublishMode] = useState(false);
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [scheduledAt, setScheduledAt] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleTargetChange = (targetId: string) => {
    setSelectedTargets(prev =>
      prev.includes(targetId)
        ? prev.filter(id => id !== targetId)
        : [...prev, targetId]
    );
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (selectedTargets.length === 0) {
      setError('Please select at least one publishing target');
      return;
    }

    setSubmitting(true);

    try {
      const response = await fetch(apiUrl(`content/${_contentId}/publish`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          targets: selectedTargets,
          scheduledAt: scheduledAt || undefined,
        }),
      });

      if (!response.ok) {
        const data = await response.json();
        setError(data.error || 'Failed to publish content');
        setSubmitting(false);
        return;
      }

      const publishedData = await response.json();
      setSuccess(`Content published successfully! Job ID: ${(publishedData.event as Record<string, unknown>).id}`);
      setPublishMode(false);
      setSelectedTargets([]);
      setScheduledAt('');
    } catch (e) {
      setError('Network error. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const renderEditor = () => {
    switch (contentType) {
      case 'image': return <ImageEditor />;
      case 'video': return <VideoEditor />;
      default: return <WebEditor />;
    }
  };

  return (
    <AppShell>
      <DomainTabs domainId={domainId} active='content' />
      <h2>Content Detail</h2>
      {renderEditor()}

      {/* Publish Content Section */}
      <section style={{ marginTop: 32, border: '1px solid #ccc', padding: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h3>Publish Content</h3>
          <button onClick={() => setPublishMode(!publishMode)}>
            {publishMode ? 'Cancel' : 'Publish'}
          </button>
        </div>

        {publishMode && (
          <form onSubmit={handlePublish} style={{ marginTop: '20px' }}>
            {error && <p style={{ color: 'red' }}>{error}</p>}
            {success && <p style={{ color: 'green' }}>{success}</p>}

            <div style={{ marginBottom: '20px' }}>
              <h4>Select Publishing Targets:</h4>
              {PUBLISHING_TARGETS.map(target => (
                <label key={target.id} style={{ display: 'block', marginBottom: '10px' }}>
                  <input
                    type="checkbox"
                    checked={selectedTargets.includes(target.id)}
                    onChange={() => handleTargetChange(target.id)}
                  />
                  {' '}{target.label}
                </label>
              ))}
            </div>

            <div style={{ marginBottom: '20px' }}>
              <label htmlFor="scheduledAt">Schedule for later (optional):</label>
              <input
                id="scheduledAt"
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            </div>

            <button type="submit" disabled={submitting || selectedTargets.length === 0}>
              {submitting ? 'Publishing...' : 'Publish Now'}
            </button>
          </form>
        )}
      </section>

      <section style={{ marginTop: 32 }}>
        <h3>Derive Distribution Assets</h3>
        <p>
          Derivations are drafts only and require explicit approval to publish.
        </p>
        <button disabled>Derive Email Draft [Coming Soon]</button>
        <button style={{ marginLeft: 8 }} disabled>Derive Social Post [Coming Soon]</button>
      </section>
    </AppShell>
  );
}

// H6-FIX: Fetch actual content from API to get real contentType instead of hardcoding 'blog'
export async function getServerSideProps({ params, req }: GetServerSidePropsContext) {
  const id = params?.['id'];
  const contentId = params?.['contentId'];
  if (typeof id !== 'string' || typeof contentId !== 'string') {
    return { notFound: true };
  }

  try {
    const res = await authFetch(apiUrl(`content/${contentId}`), { ctx: { req } });
    const { item } = await res.json();
    return {
      props: {
        domainId: id,
        contentId,
        contentType: item?.contentType || 'article',
      },
    };
  } catch {
    return { props: { domainId: id, contentId, contentType: 'article' } };
  }
}
