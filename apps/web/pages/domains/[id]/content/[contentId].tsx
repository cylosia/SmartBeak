import type { GetServerSidePropsContext } from 'next';
import { AppShell } from '../../../../components/AppShell';
import { DomainTabs } from '../../../../components/DomainTabs';
import { AudioEditor } from '../../../../components/editors/AudioEditor';
import { ImageEditor } from '../../../../components/editors/ImageEditor';
import { SocialEditor } from '../../../../components/editors/SocialEditor';
import { VideoEditor } from '../../../../components/editors/VideoEditor';
import { WebEditor } from '../../../../components/editors/WebEditor';

interface ContentDetailProps {
  domainId: string;
  contentId: string;
  type: string;
}

export default function ContentDetail({ domainId, contentId, type }: ContentDetailProps) {
  const renderEditor = () => {
    switch (type) {
      case 'image': return <ImageEditor />;
      case 'video': return <VideoEditor />;
      case 'audio': return <AudioEditor />;
      case 'social': return <SocialEditor />;
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
        <button>➕ Derive Email Draft</button>
        <button style={{ marginLeft: 8 }}>➕ Derive Social Post</button>
      </section>
    </AppShell>
  );
}

export async function getServerSideProps({ params }: GetServerSidePropsContext) {
  const id = params?.['id'];
  const contentId = params?.['contentId'];
  if (typeof id !== 'string' || typeof contentId !== 'string') {
    return { notFound: true };
  }
  return { props: { domainId: id, contentId, type: 'blog' } };
}
