import type { GetServerSidePropsContext } from 'next';

import { AppShell } from '../../../../components/AppShell';
import { DomainTabs } from '../../../../components/DomainTabs';
import { AudioEditor } from '../../../../components/editors/AudioEditor';
import { ImageEditor } from '../../../../components/editors/ImageEditor';
import { SocialEditor } from '../../../../components/editors/SocialEditor';
import { VideoEditor } from '../../../../components/editors/VideoEditor';
import { WebEditor } from '../../../../components/editors/WebEditor';
import { authFetch, apiUrl } from '../../../../lib/api-client';

interface ContentDetailProps {
  domainId: string;
  contentId: string;
  contentType: string;
}

export default function ContentDetail({ domainId, contentId, contentType }: ContentDetailProps) {
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

      <section style={{ marginTop: 32 }}>
        <h3>Derive Distribution Assets</h3>
        <p>
          Derivations are drafts only and require explicit approval to publish.
        </p>
        <button>Derive Email Draft</button>
        <button style={{ marginLeft: 8 }}>Derive Social Post</button>
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
